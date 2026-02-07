import { SQL } from 'bun'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import type {
  TipTopPaySubscription,
  TildaPaymentModel,
  TildaWebhookFormRawModel,
  TildaWebhookModel,
  UserCreateModel,
  UserModel,
} from './models'
import { fetchSubscriptionsCSV, loginToTipTopPay, parseSubscriptionsCSV } from "./tiptoppay";

const app = new Hono()
const dbPath = process.env.DB_PATH ?? './db/app.db'
const db = new SQL(`file://${dbPath}`)
console.info('[app] Database initialized', {dbPath})

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/favicon.ico', (c) => {
  const faviconFile = Bun.file(new URL('../favicon.ico', import.meta.url))
  return c.body(faviconFile, 200, {
    'Content-Type': 'image/x-icon',
    'Cache-Control': 'public, max-age=86400',
  })
})

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'Active':
    case 'Активна':
      return 'status-active'
    case 'PastDue':
    case 'Просрочена':
      return 'status-pastdue'
    case 'Cancelled':
    case 'Отменена':
      return 'status-cancelled'
    case 'Rejected':
    case 'Отклонена':
      return 'status-rejected'
    case 'Expired':
    case 'Завершена':
      return 'status-expired'
    default:
      return 'status-unknown'
  }
}

function isReportAccessAllowed(email: string, password: string): boolean {
  const expectedEmail = process.env.REPORT_EMAIL ?? process.env.TIPTOPPAY_LOGIN ?? ''
  const expectedPassword = process.env.REPORT_PASSWORD ?? process.env.TIPTOPPAY_PASSWORD ?? ''
  return expectedEmail.length > 0 && expectedPassword.length > 0 && email === expectedEmail && password === expectedPassword
}

async function buildReportHtml(email: string, password: string): Promise<string> {
  const users: UserModel[] = await db`
    select id, first_name, last_name, phone, graduation_year, email
    from users
    order by graduation_year asc, last_name asc, first_name asc
  `;

  const cookies = await loginToTipTopPay({ login: email, password });
  const csvData = await fetchSubscriptionsCSV(cookies.cookies);
  const subscriptions = parseSubscriptionsCSV(csvData);

  const subscriptionsByEmail = new Map<string, TipTopPaySubscription[]>();
  for (const sub of subscriptions) {
    const normalizedEmail = sub.email.trim().toLowerCase();
    const existing = subscriptionsByEmail.get(normalizedEmail);
    if (existing) {
      existing.push(sub);
    } else {
      subscriptionsByEmail.set(normalizedEmail, [sub]);
    }
  }

  const usersByYear = new Map<number, { user: UserModel; subscriptions: TipTopPaySubscription[] }[]>();
  for (const user of users) {
    const normalizedEmail = user.email.trim().toLowerCase();
    const joinedSubscriptions = subscriptionsByEmail.get(normalizedEmail) ?? [];
    const row = { user, subscriptions: joinedSubscriptions };
    const existing = usersByYear.get(user.graduation_year);
    if (existing) {
      existing.push(row);
    } else {
      usersByYear.set(user.graduation_year, [row]);
    }
  }

  const graduationYears = Array.from(usersByYear.keys()).sort((a, b) => a - b);
  const sections = graduationYears
    .map((year) => {
      const rows = usersByYear.get(year) ?? [];
      const rowsHtml = rows
        .map(({ user, subscriptions: userSubscriptions }) => {
          const summary = userSubscriptions.length === 0
            ? '-'
            : userSubscriptions
              .map((sub) => {
                const statusClass = getStatusClass(sub.status)
                const lastPayment = sub.lastPaymentDate?.trim() ? escapeHtml(sub.lastPaymentDate) : '-'
                const nextPayment = sub.nextPaymentDate?.trim() ? escapeHtml(sub.nextPaymentDate) : '-'
                const paymentCount = sub.paymentCount?.trim() ? escapeHtml(sub.paymentCount) : '-'
                return `<span class="${statusClass}">${escapeHtml(sub.status)}</span> (${escapeHtml(sub.amount)} ${escapeHtml(sub.currency)}) | Count: ${paymentCount} | Last: ${lastPayment} | Next: ${nextPayment}`
              })
              .join('<br>');

          return `
            <tr>
              <td>${user.id}</td>
              <td>${escapeHtml(`${user.first_name} ${user.last_name}`)}</td>
              <td>${escapeHtml(user.email)}</td>
              <td>${escapeHtml(user.phone)}</td>
              <td>${userSubscriptions.length}</td>
              <td>${summary}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <h2>Graduation year: ${year}</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Subscriptions</th>
                <th>Subscription details</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <title>Jezgrads - Subscription</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap');
          body { font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; margin: 24px; color: #222; }
          h1 { margin-bottom: 4px; }
          h2 { margin: 24px 0 8px; }
          .table-scroll { width: 100%; overflow-x: auto; margin-bottom: 16px; }
          table { width: 100%; min-width: 920px; border-collapse: collapse; margin-bottom: 0; }
          th, td { border: 1px solid #ddd; padding: 10px; text-align: left; vertical-align: top; line-height: 1.45; white-space: nowrap; }
          th { background: #f5f5f5; }
          td { word-break: normal; overflow-wrap: normal; }
          .status-active { color: #0b7a24; font-weight: 600; }
          .status-pastdue { color: #b26a00; font-weight: 600; }
          .status-cancelled { color: #7a1f1f; font-weight: 600; }
          .status-rejected { color: #d10000; font-weight: 700; }
          .status-expired { color: #555; font-weight: 600; }
          .status-unknown { color: #333; font-weight: 600; }

          @media (max-width: 1024px) {
            body { margin: 16px; font-size: 14px; }
            th, td { padding: 7px; line-height: 1.35; }
            td { word-break: break-word; }
          }

          @media (max-width: 768px) {
            body { margin: 12px; font-size: 13px; }
            h1 { font-size: 20px; }
            h2 { font-size: 16px; margin-top: 16px; }
            th, td { padding: 6px; }
          }

          @media (max-width: 480px) {
            body { margin: 10px; font-size: 12px; }
            h1 { font-size: 18px; }
            h2 { font-size: 15px; }
            th, td { padding: 5px; }
          }
        </style>
      </head>
      <body>
        <h1>Jezgrads - Subscriptions</h1>
        <p>Total users: ${users.length}. Total subscriptions: ${subscriptions.length}.</p>
        <h2>Subscription statuses</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Description</th>
                <th>When applied</th>
                <th>Possible actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Active</td>
                <td>Подписка активна</td>
                <td>После создания и очередной успешной оплаты</td>
                <td>Отмена</td>
              </tr>
              <tr>
                <td>PastDue</td>
                <td>Просрочена</td>
                <td>После одной или двух подряд неуспешных попыток оплаты</td>
                <td>Отмена</td>
              </tr>
              <tr>
                <td>Cancelled</td>
                <td>Отменена</td>
                <td>В случае отмены по запросу</td>
                <td>Нет</td>
              </tr>
              <tr>
                <td>Rejected</td>
                <td>Отклонена</td>
                <td>В случае трех неудачных попыток оплаты, идущих подряд</td>
                <td>Нет</td>
              </tr>
              <tr>
                <td>Expired</td>
                <td>Завершена</td>
                <td>В случае завершения максимального количества периодов (если были указаны)</td>
                <td>Нет</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${sections || '<p>No users found.</p>'}
      </body>
    </html>
  `;
}

app.get('/report', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <title>Jezgrads - Report Login</title>
      </head>
      <body>
        <script>
          (async () => {
            const email = window.prompt('Enter email');
            if (!email) {
              document.body.innerText = 'Access cancelled';
              return;
            }

            const password = window.prompt('Enter password');
            if (!password) {
              document.body.innerText = 'Access cancelled';
              return;
            }

            try {
              const response = await fetch('/report/data', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
              });

              if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                const message = payload.error || 'Access denied';
                window.alert(message);
                document.body.innerText = message;
                return;
              }

              const reportHtml = await response.text();
              document.open();
              document.write(reportHtml);
              document.close();
            } catch (error) {
              document.body.innerText = 'Failed to load report';
            }
          })();
        </script>
      </body>
    </html>
  `)
})

app.post('/report/data', async (c) => {
  try {
    const payload = await c.req.json<{ email?: string; password?: string }>()
    const email = payload.email?.trim() ?? ''
    const password = payload.password ?? ''

    if (!isReportAccessAllowed(email, password)) {
      return c.json({ ok: false, error: 'Access denied' }, 401)
    }

    const html = await buildReportHtml(email, password)
    return c.html(html)
  } catch (error) {
    console.error('Error loading protected report:', error);
    throw new HTTPException(500, {
      message: 'Failed to retrieve and parse subscriptions',
    });
  }
})


app.post('/webhook', async (c) => {
  const body = await c.req.parseBody()
  const raw = body as Record<string, string>
  const expectedSecret = process.env.SECRET
  console.info('[webhook] Incoming request', {keys: Object.keys(raw)})

  if (!expectedSecret) {
    console.error('[webhook] SECRET is not set')
    return c.json(
      {
        ok: false,
        error: 'Server misconfiguration: SECRET is not set',
      },
      500
    )
  }

  const rawKeys = Object.keys(raw)
  const isTestPayload =
    rawKeys.includes('test') && rawKeys.every((key) => key === 'test' || key === 'SECRET')

  if (isTestPayload) {
    console.info('[webhook] Test payload detected')
    if (!raw.SECRET) {
      console.warn('[webhook] Missing secret in test payload')
      return c.json(
        {
          ok: false,
          error: 'Missing secret',
        },
        400
      )
    }

    if (raw.SECRET !== expectedSecret) {
      console.warn('[webhook] Invalid secret in test payload')
      return c.json(
        {
          ok: false,
          error: 'Invalid secret',
        },
        401
      )
    }

    return c.text('OK')
  }

  const requiredFields: (keyof TildaWebhookFormRawModel)[] = [
    'SECRET',
    'email',
    'formid',
    'formname',
    'graduation_year',
    'name',
    'payment',
    'phone',
    'surname',
  ]

  const missing = requiredFields.filter((key) => !raw[key])
  if (missing.length > 0) {
    console.warn('[webhook] Missing required fields', {missing})
    return c.json(
      {
        ok: false,
        error: `Missing fields: ${missing.join(', ')}`,
      },
      400
    )
  }

  if (raw.SECRET !== expectedSecret) {
    console.warn('[webhook] Invalid secret')
    return c.json(
      {
        ok: false,
        error: 'Invalid secret',
      },
      401
    )
  }

  let payment: TildaPaymentModel
  try {
    payment = JSON.parse(raw.payment) as TildaPaymentModel
  } catch {
    console.warn('[webhook] Invalid payment JSON')
    return c.json(
      {
        ok: false,
        error: 'Invalid payment JSON',
      },
      400
    )
  }

  const webhook: TildaWebhookModel = {
    email: raw.email,
    formid: raw.formid,
    formname: raw.formname,
    graduation_year: raw.graduation_year,
    name: raw.name,
    payment,
    phone: raw.phone,
    surname: raw.surname,
  }

  const graduationYear = Number(raw.graduation_year)
  if (!Number.isFinite(graduationYear)) {
    console.warn('[webhook] Invalid graduation_year', {value: raw.graduation_year})
    return c.json(
      {
        ok: false,
        error: 'Invalid graduation_year',
      },
      400
    )
  }

  const user: UserCreateModel = {
    first_name: raw.name,
    last_name: raw.surname,
    phone: raw.phone.replace(/\D/g, ''),
    graduation_year: graduationYear,
    email: raw.email,
  }

  if (user.phone.length === 0) {
    console.warn('[webhook] Invalid phone')
    return c.json(
      {
        ok: false,
        error: 'Invalid phone',
      },
      400
    )
  }

  try {
    const rows: { id: number }[] = (await db`
      insert into users (first_name, last_name, email, graduation_year, phone)
      values (${user.first_name}, ${user.last_name}, ${user.email}, ${user.graduation_year}, ${user.phone}) returning id
    `);
    console.info('[webhook] User created', {userId: rows[0].id, email: user.email})

    return c.json({
      ok: true,
      data: webhook,
      user: {
        id: rows[0].id,
        ...user,
      },
    })
  } catch (error) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      console.warn('[webhook] Duplicate user', {email: user.email})
      return c.json(
        {
          ok: false,
          error: `User with this email ${user.email} already exists`,
        },
        409
      )
    }

    console.error('[webhook] Database error', {code: err.code, message: err.message})
    return c.json(
      {
        ok: false,
        error: err.message ?? 'Database error',
      },
      500
    )
  }
})

export default app
