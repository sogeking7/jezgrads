import { SQL } from 'bun'
import { Hono } from 'hono'
import type {
  TildaPaymentModel,
  TildaWebhookFormRawModel,
  TildaWebhookModel,
  UserCreateModel,
} from './models'

const app = new Hono()
const dbPath = process.env.DB_PATH ?? './db/app.db'
const db = new SQL(`file://${dbPath}`)
console.info('[app] Database initialized', { dbPath })

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.post('/webhook', async (c) => {
  const body = await c.req.parseBody()
  const raw = body as Record<string, string>
  const expectedSecret = process.env.SECRET
  console.info('[webhook] Incoming request', { keys: Object.keys(raw) })

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
    console.warn('[webhook] Missing required fields', { missing })
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
    console.warn('[webhook] Invalid graduation_year', { value: raw.graduation_year })
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
    console.info('[webhook] User created', { userId: rows[0].id, email: user.email })

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
      console.warn('[webhook] Duplicate user', { email: user.email })
      return c.json(
        {
          ok: false,
          error: `User with this email ${user.email} already exists`,
        },
        409
      )
    }

    console.error('[webhook] Database error', { code: err.code, message: err.message })
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
