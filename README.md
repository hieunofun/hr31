# HR31

Bản sao giao diện và chức năng của HR-Company-23, dùng chung Supabase project với HR-Company-22 và HR-Company-23. Dữ liệu của HR31 được gắn `company_id` riêng: `00000000-0000-0000-0000-000000000031`.

## Chạy tại máy

```bash
npm ci
npm run dev
```

Mở http://localhost:3031. `.env.local` chứa URL và public key của Supabase dùng chung. Không đưa file này lên Git.

## Tài khoản và dữ liệu

- Bản ghi công ty `Hr31` được tạo bằng [supabase/01_create_company_31.sql](supabase/01_create_company_31.sql). Script chỉ tác động lên công ty có ID 31.
- Tài khoản đăng nhập phải có hồ sơ `users.company_id` bằng ID 31; tài khoản của HR22/HR23 sẽ bị từ chối.
- Dữ liệu nhân sự/chấm công của HR31 sẽ nằm trong các bảng dùng chung và mang `company_id` 31. Không chạy các script schema/seed cũ của HR-Company-23 trên database dùng chung.

## Build

```bash
npm run build
```

Khi tạo Vercel project riêng cho HR31, đặt `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` và `VITE_DEFAULT_COMPANY_ID` giống `.env.local`. Không liên kết bản này với Vercel project của HR22/HR23.
