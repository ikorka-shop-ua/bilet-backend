-- Білет за замовлення — схема бази (Supabase → SQL Editor → вставити й виконати один раз)

create table if not exists managers (
  id            serial primary key,
  name          text not null,
  phone         text,
  odoo_user_id  integer,
  code_hash     text unique,
  is_admin      boolean not null default false,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  token       text primary key,
  manager_id  integer not null references managers(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists tickets (
  id            bigserial primary key,
  manager_id    integer not null references managers(id),
  order_no      text not null,
  order_key     text not null unique,          -- номер без пробілів, у нижньому регістрі: один номер = один білет
  odoo_id       integer,                        -- id замовлення в Odoo для синхронізації статусу
  created_at    timestamptz not null default now(),
  amount        integer not null default 0,     -- приз у грн (0 = порожньо)
  kind          smallint not null default 0,    -- 0 порожньо, 1 грошовий, 2 джекпот
  scratched     boolean not null default false,
  gold          boolean not null default false,
  mult_c        numeric not null default 1,     -- множник шансів на момент видачі
  mult_p        numeric not null default 1,     -- множник призів
  no_empty      boolean not null default false,
  jp_mult       numeric not null default 1,
  fireworks     boolean not null default false,
  prob          numeric,                        -- ймовірність випалого призу, %
  status        text check (status in ('w','c','x')),  -- очікує / підтверджено / скасовано; null для порожніх
  status_source text not null default 'auto',   -- auto = з Odoo, manual = змінив керівник
  odoo_stage    text,
  checked_at    timestamptz
);
create index if not exists tickets_created_idx on tickets (created_at);
create index if not exists tickets_manager_idx on tickets (manager_id, created_at);
create index if not exists tickets_pending_idx on tickets (status) where status = 'w';

create table if not exists settings (
  key    text primary key,
  value  jsonb not null
);

create table if not exists jackpot (
  month         text primary key,   -- 'YYYY-MM'
  reset_orders  integer not null default 0,
  last_win      jsonb
);

-- v2: самостійна реєстрація менеджерів (телефон + PIN)
alter table managers add column if not exists pin_hash text;
alter table managers add column if not exists pin_reset boolean not null default false;
create unique index if not exists managers_phone_uniq on managers (phone) where phone is not null;
create unique index if not exists managers_odoo_uniq on managers (odoo_user_id) where odoo_user_id is not null;
