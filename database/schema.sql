create table if not exists students (
 id bigint generated always as identity primary key,
 roll_no text not null unique check (length(trim(roll_no)) between 1 and 30),
 name text not null check (length(trim(name)) between 1 and 100),
 class_name text not null check (length(trim(class_name)) between 1 and 60),
 created_at timestamptz not null default now()
);
create table if not exists subjects (
 id bigint generated always as identity primary key,
 name text not null unique check (length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now()
);
create table if not exists attendance (
 id bigint generated always as identity primary key,
 student_id bigint not null references students(id) on delete cascade,
 subject_id bigint not null references subjects(id) on delete cascade,
 attendance_date date not null,
 status text not null check (status in ('Present','Absent')),
 recorded_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(student_id,subject_id,attendance_date)
);
create index if not exists attendance_date_idx on attendance(attendance_date);
create index if not exists attendance_student_idx on attendance(student_id);
create index if not exists attendance_subject_idx on attendance(subject_id);
alter table students enable row level security;
alter table subjects enable row level security;
alter table attendance enable row level security;
-- No public policies: the server uses the secret key only after verifying a teacher JWT.
