create table if not exists users
(
  id              integer primary key autoincrement,
  first_name      varchar(255) not null,
  last_name       varchar(255) not null,
  email           varchar(255) not null unique,
  graduation_year int          not null,
  phone           varchar(15)  not null
);
