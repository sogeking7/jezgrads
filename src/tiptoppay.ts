import { TipTopPayLoginRequest, TipTopPaySubscription } from "./models";

export async function loginToTipTopPay(): Promise<{ cookies: string[] }> {
  const loginURL = 'https://id.tiptoppay.kz/api/login';

  const credentials: TipTopPayLoginRequest = {
    login: process.env.TIPTOPPAY_LOGIN ?? '',
    password: process.env.TIPTOPPAY_PASSWORD ?? '',
  };

  console.log('Attempting login to TipTopPay with payload:', JSON.stringify(credentials));

  try {
    const response = await fetch(loginURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const body = await response.text();

    console.log('Login response status:', response.status);
    console.log('Login response body:', body);

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Login failed with status ${response.status}: ${body}`);
    }

    const setCookieHeader = response.headers.get('set-cookie');
    if (!setCookieHeader) {
      throw new Error('No cookies received from login');
    }

    const cookies = setCookieHeader.split(',').map(cookie => cookie.trim());

    console.log(`Received ${cookies.length} cookies from login`);

    if (cookies.length === 0) {
      throw new Error('No cookies received from login');
    }

    console.log('Successfully logged in to TipTopPay');
    return {cookies};
  } catch (error) {
    console.error('Login error:', error);
    throw new Error(`Login request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}


export async function fetchSubscriptionsCSV(cookies: string[], payerEmail?: string): Promise<string> {
  const baseURL = 'https://merchant.tiptoppay.kz/api/subscriptions';
  const params = new URLSearchParams({
    SiteIds: '4065609',
    TimezoneOffset: '05:00',
  });

  if (payerEmail) {
    params.append('Payer', payerEmail);
  }

  const subscriptionsURL = `${baseURL}?${params.toString()}`;

  console.log('Fetching subscriptions (URL:', subscriptionsURL + ')');

  try {
    const response = await fetch(subscriptionsURL, {
      method: 'GET',
      headers: {
        'Accept': 'text/csv',
        'Cookie': cookies.join('; '),
      },
    });

    const csvData = await response.text();

    console.log('Subscriptions response status:', response.status);

    if (response.status !== 200) {
      throw new Error(`Subscriptions request failed with status ${response.status}: ${csvData}`);
    }

    console.log(`Successfully retrieved subscriptions CSV, size: ${csvData.length} bytes`);
    return csvData;
  } catch (error) {
    console.error('Fetch subscriptions error:', error);
    throw new Error(`Subscriptions request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseSubscriptionsCSV(csvData: string): TipTopPaySubscription[] {
  const lines = csvData.split('\n').filter(line => line.trim() !== '');

  if (lines.length < 2) {
    console.log('CSV has no data rows (only header or empty). Returning empty list.');
    return [];
  }

  const header = lines[0].split(';').map(col => col.trim());
  console.log(`CSV parsed with ${header.length} columns, ${lines.length - 1} data rows`);

  const nextPaymentDateIdx = header.findIndex(col =>
    col.includes('Дата/время следующего платежа') || col.includes('следующего платежа')
  );

  if (nextPaymentDateIdx === -1) {
    throw new Error("Could not find 'Дата/время следующего платежа' column");
  }

  const subscriptions: TipTopPaySubscription[] = [];

  for (let i = 1; i < lines.length; i++) {
    const record = lines[i].split(';').map(field => field.trim());

    if (record.length < 12) {
      console.log(`Skipping row ${i}: insufficient columns (${record.length})`);
      continue;
    }

    // console.log(record);

    const sub: TipTopPaySubscription = {
      id: record[0],
      createdAt: record[1],
      status: record[2],
      amount: record[3],
      currency: record[4],
      frequency: record[5],
      description: record[6],
      payerId: record[7],
      email: record[8],
      paymentCount: record[9],
      lastPaymentDate: record[10],
      nextPaymentDate: record[11],
    };

    // Parse next payment date (format: DD.MM.YYYY HH:MM:SS)
    if (sub.nextPaymentDate && sub.nextPaymentDate.trim() !== '') {
      try {
        // Parse DD.MM.YYYY HH:MM:SS format
        const [datePart, timePart] = sub.nextPaymentDate.split(' ');
        const [day, month, year] = datePart.split('.');
        const [hours, minutes, seconds] = timePart.split(':');

        const parsedDate = new Date(
          parseInt(year),
          parseInt(month) - 1, // months are 0-indexed
          parseInt(day),
          parseInt(hours),
          parseInt(minutes),
          parseInt(seconds)
        );

        if (!isNaN(parsedDate.getTime())) {
          sub.nextPaymentParsed = parsedDate;
        } else {
          // console.log(`Failed to parse date '${sub.nextPaymentDate}' for subscription ${sub.id}`);
        }
      } catch (error) {
        // console.log(`Failed to parse date '${sub.nextPaymentDate}' for subscription ${sub.id}:`, error);
      }
    } else {
      // console.log(`Subscription ${sub.id} (${sub.email}) has no next payment date - possibly completed or cancelled`);
    }

    subscriptions.push(sub);
  }

  // console.log(`Parsed ${subscriptions.length} total subscriptions from CSV`);
  return subscriptions;
}
