-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    auth_provider VARCHAR(20), -- 'google', 'facebook', 'email'
    auth_provider_id VARCHAR(100)
);

-- Kingdoms table
CREATE TABLE kingdoms (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR(50) NOT NULL,
    race_id INTEGER NOT NULL,
    country_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    gold INTEGER DEFAULT 1000,
    wood INTEGER DEFAULT 500,
    stone INTEGER DEFAULT 500,
    food INTEGER DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Resources table
CREATE TABLE resources (
    id SERIAL PRIMARY KEY,
    kingdom_id INTEGER REFERENCES kingdoms(id),
    resource_type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Buildings table
CREATE TABLE buildings (
    id SERIAL PRIMARY KEY,
    kingdom_id INTEGER REFERENCES kingdoms(id),
    building_type VARCHAR(50) NOT NULL,
    level INTEGER DEFAULT 1,
    health INTEGER DEFAULT 100,
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Units table
CREATE TABLE units (
    id SERIAL PRIMARY KEY,
    kingdom_id INTEGER REFERENCES kingdoms(id),
    unit_type VARCHAR(50) NOT NULL,
    quantity INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    is_training BOOLEAN DEFAULT false,
    training_end_time TIMESTAMP
);

-- Alliances table
CREATE TABLE alliances (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    leader_id INTEGER REFERENCES users(id),
    level INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alliance members table
CREATE TABLE alliance_members (
    id SERIAL PRIMARY KEY,
    alliance_id INTEGER REFERENCES alliances(id),
    user_id INTEGER REFERENCES users(id),
    role VARCHAR(20) DEFAULT 'member', -- 'leader', 'officer', 'member'
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attacks table
CREATE TABLE attacks (
    id SERIAL PRIMARY KEY,
    attacker_id INTEGER REFERENCES kingdoms(id),
    defender_id INTEGER REFERENCES kingdoms(id),
    attack_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    resources_stolen JSON,
    units_lost JSON
);

-- Daily tasks table
CREATE TABLE daily_tasks (
    id SERIAL PRIMARY KEY,
    task_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    reward_type VARCHAR(20) NOT NULL,
    reward_amount INTEGER NOT NULL,
    difficulty VARCHAR(20) NOT NULL -- 'easy', 'medium', 'hard'
);

-- User daily tasks progress
CREATE TABLE user_daily_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    task_id INTEGER REFERENCES daily_tasks(id),
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    UNIQUE(user_id, task_id)
);

-- Races table
CREATE TABLE races (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    special_unit_1 VARCHAR(50),
    special_unit_2 VARCHAR(50),
    special_unit_3 VARCHAR(50)
);

-- Countries table
CREATE TABLE countries (
    id SERIAL PRIMARY KEY,
    race_id INTEGER REFERENCES races(id),
    name VARCHAR(50) NOT NULL,
    description TEXT,
    special_unit_1 VARCHAR(50),
    special_unit_2 VARCHAR(50),
    special_unit_3 VARCHAR(50)
); 