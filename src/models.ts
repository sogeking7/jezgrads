export type UserModel = {
    id: number;
    first_name: string;
    last_name: string;
    phone: string;
    graduation_year: number;
    email: string;
}

export type UserCreateModel = Omit<UserModel, 'id'>;

export type TildaPaymentModel = {
    orderid: string;
    products: string[];
    amount: string;
};

export type TildaWebhookFormRawModel = {
    SECRET?: string;
    email: string;
    formid: string;
    formname: string;
    graduation_year: string;
    name: string;
    payment: string;
    phone: string;
    surname: string;
};

export type TildaWebhookModel = Omit<TildaWebhookFormRawModel, 'payment' | 'SECRET'> & {
    payment: TildaPaymentModel;
};
