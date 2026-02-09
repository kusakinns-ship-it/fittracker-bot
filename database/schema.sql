-- =============================================
-- FITTRACKER DATABASE SCHEMA
-- =============================================

-- Удаляем таблицы если существуют (для чистой установки)
DROP TABLE IF EXISTS workout_sets CASCADE;
DROP TABLE IF EXISTS workout_exercises CASCADE;
DROP TABLE IF EXISTS workouts CASCADE;
DROP TABLE IF EXISTS program_exercises CASCADE;
DROP TABLE IF EXISTS programs CASCADE;
DROP TABLE IF EXISTS exercises CASCADE;
DROP TABLE IF EXISTS client_metrics CASCADE;
DROP TABLE IF EXISTS trainer_clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =============================================
-- ПОЛЬЗОВАТЕЛИ
-- =============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    role VARCHAR(20) DEFAULT 'client' CHECK (role IN ('client', 'trainer', 'admin')),
    subscription_type VARCHAR(20) DEFAULT 'free' CHECK (subscription_type IN ('free', 'lite', 'premium', 'trainer_start', 'trainer_pro', 'trainer_business')),
    subscription_expires_at TIMESTAMP WITH TIME ZONE,
    language_code VARCHAR(10) DEFAULT 'ru',
    timezone VARCHAR(50) DEFAULT 'Europe/Moscow',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- СВЯЗЬ ТРЕНЕР-КЛИЕНТ
-- =============================================
CREATE TABLE trainer_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(trainer_id, client_id)
);

-- =============================================
-- МЕТРИКИ КЛИЕНТА (вес, состав тела)
-- =============================================
CREATE TABLE client_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    weight DECIMAL(5,2),
    body_fat_percent DECIMAL(4,1),
    muscle_mass DECIMAL(5,2),
    -- InBody данные
    skeletal_muscle_mass DECIMAL(5,2),
    body_fat_mass DECIMAL(5,2),
    total_body_water DECIMAL(5,2),
    -- Дополнительные замеры
    chest_cm DECIMAL(5,1),
    waist_cm DECIMAL(5,1),
    hips_cm DECIMAL(5,1),
    biceps_cm DECIMAL(5,1),
    thigh_cm DECIMAL(5,1),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- БИБЛИОТЕКА УПРАЖНЕНИЙ
-- =============================================
CREATE TABLE exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    category VARCHAR(50) CHECK (category IN ('compound', 'isolation', 'cardio', 'mobility')),
    muscle_groups TEXT[], -- ['chest', 'triceps', 'shoulders']
    equipment VARCHAR(50), -- 'barbell', 'dumbbell', 'machine', 'bodyweight'
    description TEXT,
    technique_notes TEXT[],
    video_url VARCHAR(500),
    is_public BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ПРОГРАММЫ ТРЕНИРОВОК
-- =============================================
CREATE TABLE programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID REFERENCES users(id),
    client_id UUID REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    goal VARCHAR(100), -- 'strength', 'hypertrophy', 'weight_loss', 'general_fitness'
    duration_weeks INT,
    days_per_week INT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
    ai_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- УПРАЖНЕНИЯ В ПРОГРАММЕ (шаблон)
-- =============================================
CREATE TABLE program_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    exercise_id UUID REFERENCES exercises(id),
    day_of_week INT CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Пн, 7=Вс
    day_name VARCHAR(100), -- "СТАНОВАЯ БАЗА + ЖИМЫ"
    order_index INT NOT NULL,
    exercise_type VARCHAR(20) DEFAULT 'working' CHECK (exercise_type IN ('warmup', 'working', 'accessory', 'finisher')),
    -- Параметры
    sets INT,
    reps VARCHAR(20), -- "5" или "8-10" или "AMRAP"
    weight_type VARCHAR(20) DEFAULT 'absolute' CHECK (weight_type IN ('absolute', 'relative', 'bodyweight', 'rpe_based')),
    weight_value DECIMAL(6,2), -- вес в кг или % от 1RM
    rest_seconds INT,
    target_rpe_min DECIMAL(3,1),
    target_rpe_max DECIMAL(3,1),
    tempo VARCHAR(20), -- "3-1-2-0"
    -- Специальные подходы
    has_warmup_sets BOOLEAN DEFAULT false,
    warmup_schema JSONB, -- [{"weight": 40, "reps": 10}, ...]
    has_heavy_single BOOLEAN DEFAULT false,
    heavy_single_weight DECIMAL(6,2),
    -- Суперсет
    is_superset BOOLEAN DEFAULT false,
    superset_with UUID REFERENCES program_exercises(id),
    -- Заметки
    technique_notes TEXT[],
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ТРЕНИРОВКИ (конкретные дни)
-- =============================================
CREATE TABLE workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    program_id UUID REFERENCES programs(id),
    trainer_id UUID REFERENCES users(id),
    week_number INT,
    day_of_week INT,
    day_name VARCHAR(100),
    scheduled_date DATE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'skipped')),
    -- Итоги
    total_volume DECIMAL(10,2), -- общий тоннаж
    duration_minutes INT,
    overall_rpe DECIMAL(3,1),
    client_feedback TEXT,
    trainer_feedback TEXT,
    ai_analysis TEXT,
    ai_recommendations TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- УПРАЖНЕНИЯ В ТРЕНИРОВКЕ
-- =============================================
CREATE TABLE workout_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id UUID REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id UUID REFERENCES exercises(id),
    program_exercise_id UUID REFERENCES program_exercises(id),
    order_index INT NOT NULL,
    -- План
    planned_sets INT,
    planned_reps VARCHAR(20),
    planned_weight DECIMAL(6,2),
    -- Факт (общий)
    completed BOOLEAN DEFAULT false,
    skipped BOOLEAN DEFAULT false,
    skip_reason TEXT,
    exercise_rpe DECIMAL(3,1),
    exercise_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ПОДХОДЫ
-- =============================================
CREATE TABLE workout_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_exercise_id UUID REFERENCES workout_exercises(id) ON DELETE CASCADE,
    set_number INT NOT NULL,
    set_type VARCHAR(20) DEFAULT 'working' CHECK (set_type IN ('warmup', 'working', 'heavy_single', 'backoff', 'drop')),
    -- План
    planned_weight DECIMAL(6,2),
    planned_reps INT,
    -- Факт
    actual_weight DECIMAL(6,2),
    actual_reps INT,
    rpe DECIMAL(3,1),
    completed BOOLEAN DEFAULT false,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ИНДЕКСЫ
-- =============================================
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_trainer_clients_trainer ON trainer_clients(trainer_id);
CREATE INDEX idx_trainer_clients_client ON trainer_clients(client_id);
CREATE INDEX idx_client_metrics_user_date ON client_metrics(user_id, date DESC);
CREATE INDEX idx_programs_trainer ON programs(trainer_id);
CREATE INDEX idx_programs_client ON programs(client_id);
CREATE INDEX idx_workouts_user ON workouts(user_id);
CREATE INDEX idx_workouts_date ON workouts(scheduled_date);
CREATE INDEX idx_workouts_status ON workouts(status);
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_sets_exercise ON workout_sets(workout_exercise_id);

-- =============================================
-- ТРИГГЕР ДЛЯ ОБНОВЛЕНИЯ updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_programs_updated_at BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workouts_updated_at BEFORE UPDATE ON workouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- БАЗОВЫЕ УПРАЖНЕНИЯ
-- =============================================
INSERT INTO exercises (name, name_en, category, muscle_groups, equipment) VALUES
-- Базовые
('Становая тяга сумо', 'Sumo Deadlift', 'compound', ARRAY['back', 'glutes', 'hamstrings'], 'barbell'),
('Становая тяга классика', 'Conventional Deadlift', 'compound', ARRAY['back', 'glutes', 'hamstrings'], 'barbell'),
('Приседания со штангой', 'Barbell Squat', 'compound', ARRAY['quads', 'glutes', 'hamstrings'], 'barbell'),
('Жим лёжа', 'Bench Press', 'compound', ARRAY['chest', 'triceps', 'shoulders'], 'barbell'),
('Жим лёжа в наклоне', 'Incline Bench Press', 'compound', ARRAY['chest', 'shoulders', 'triceps'], 'barbell'),
('Тяга штанги в наклоне', 'Barbell Row', 'compound', ARRAY['back', 'biceps'], 'barbell'),
('Жим стоя', 'Overhead Press', 'compound', ARRAY['shoulders', 'triceps'], 'barbell'),
-- Изоляция ноги
('Сгибания ног сидя', 'Seated Leg Curl', 'isolation', ARRAY['hamstrings'], 'machine'),
('Разгибания ног', 'Leg Extension', 'isolation', ARRAY['quads'], 'machine'),
('Nordic Curl', 'Nordic Curl', 'isolation', ARRAY['hamstrings'], 'bodyweight'),
('Сведение ног', 'Hip Adduction', 'isolation', ARRAY['adductors'], 'machine'),
('Разведение ног', 'Hip Abduction', 'isolation', ARRAY['abductors'], 'machine'),
-- Изоляция верх
('Разводка гантелей', 'Dumbbell Fly', 'isolation', ARRAY['chest'], 'dumbbell'),
('Подъём на бицепс', 'Bicep Curl', 'isolation', ARRAY['biceps'], 'dumbbell'),
('Французский жим', 'Skull Crusher', 'isolation', ARRAY['triceps'], 'barbell'),
('Махи гантелей в стороны', 'Lateral Raise', 'isolation', ARRAY['shoulders'], 'dumbbell');

-- =============================================
-- ROW LEVEL SECURITY (безопасность)
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;

-- Политики будут добавлены после настройки аутентификации
