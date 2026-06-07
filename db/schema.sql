-- Enable UUID generation extension if not present
create extension if not exists "uuid-ossp";

-- 1. Create Profiles Table
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    name varchar(100),
    email varchar(255) unique,
    contact_no varchar(20),
    avatar_url text,
    updated_at timestamp with time zone default now()
);

-- 2. Create User Status Table
create table public.user_status (
    id uuid references public.profiles on delete cascade primary key,
    is_online boolean default false not null,
    last_seen timestamp with time zone default now()
);

-- 3. Create Rooms Table
create table public.rooms (
    id uuid default gen_random_uuid() primary key,
    is_group boolean default false not null,
    name varchar(100),
    created_at timestamp with time zone default now()
);

-- 4. Create Room Members Bridge Table
create table public.room_members (
    id bigint generated always as identity primary key,
    room_id uuid references public.rooms on delete cascade not null,
    user_id uuid references public.profiles on delete cascade not null,
    joined_at timestamp with time zone default now(),
    unique (room_id, user_id)
);

-- 5. Create Messages Table
create table public.messages (
    id bigint generated always as identity primary key,
    room_id uuid references public.rooms on delete cascade not null,
    sender_id uuid references public.profiles on delete set null,
    text text,
    file_url text,
    status varchar(15) default 'sent' not null,
    created_at timestamp with time zone default now() not null
);

-- 6. Apply Performance Indexes
create index idx_profiles_email on public.profiles (email);
create index idx_messages_room_created on public.messages (room_id, created_at desc);
