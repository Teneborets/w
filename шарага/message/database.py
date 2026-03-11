import sqlite3
import bcrypt
import os
import random
import string

DB_NAME = 'messenger.db'

def get_db_connection():
    """Создание подключения к базе данных"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Инициализация базы данных - создание таблиц пользователей и сообщений"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            user_id TEXT UNIQUE,
            username TEXT,
            avatar_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_admin INTEGER DEFAULT 0
        )
    ''')
    
    # Добавляем новые колонки, если их нет (для существующих баз данных)
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN user_id TEXT UNIQUE')
    except sqlite3.OperationalError:
        pass  # Колонка уже существует
    
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN username TEXT')
    except sqlite3.OperationalError:
        pass  # Колонка уже существует

    try:
        cursor.execute('ALTER TABLE users ADD COLUMN avatar_path TEXT')
    except sqlite3.OperationalError:
        pass  # Колонка уже существует

    # Надёжная миграция колонок для старых БД (SQLite иногда падает на DEFAULT CURRENT_TIMESTAMP в ALTER)
    cursor.execute("PRAGMA table_info(users)")
    user_cols = {row[1] for row in cursor.fetchall()}

    if 'last_activity' not in user_cols:
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN last_activity TIMESTAMP')
            # Для существующих пользователей заполняем текущим временем
            cursor.execute('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE last_activity IS NULL')
        except sqlite3.OperationalError:
            # Если по какой-то причине не вышло — не роняем приложение, но дальше запросы могут падать
            pass

    if 'is_admin' not in user_cols:
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0')
            cursor.execute('UPDATE users SET is_admin = 0 WHERE is_admin IS NULL')
        except sqlite3.OperationalError:
            pass

    # Уникальный индекс для username (каждое имя пользователя должно быть уникальным, NULL допускается)
    try:
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)')
    except sqlite3.OperationalError:
        # Индекс уже существует или не может быть создан - продолжим без падения
        pass
    
    # Генерируем user_id для пользователей, у которых его нет
    cursor.execute('SELECT id, phone FROM users WHERE user_id IS NULL')
    users_without_id = cursor.fetchall()
    for user in users_without_id:
        # Генерируем уникальный user_id из 8 символов
        while True:
            new_user_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            cursor.execute('SELECT id FROM users WHERE user_id = ?', (new_user_id,))
            if not cursor.fetchone():
                cursor.execute('UPDATE users SET user_id = ? WHERE id = ?', (new_user_id, user['id']))
                break
    
    conn.commit()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message TEXT,
            image_path TEXT,
            reply_to_id INTEGER,
            is_pinned INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id),
            FOREIGN KEY (reply_to_id) REFERENCES messages(id)
        )
    ''')
    
    # Добавляем новые колонки, если их нет
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN image_path TEXT')
    except sqlite3.OperationalError:
        pass
    
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER')
    except sqlite3.OperationalError:
        pass
    
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
    
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
    
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN updated_at TIMESTAMP')
    except sqlite3.OperationalError:
        pass

    # Таблица друзей (односторонние связи: user_id -> friend_id)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            friend_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (friend_id) REFERENCES users(id)
        )
    ''')

    # Уникальная пара user_id + friend_id
    try:
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_unique ON friends(user_id, friend_id)')
    except sqlite3.OperationalError:
        pass

    # Таблица блокировок пользователей
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS blocked_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blocker_id INTEGER NOT NULL,
            blocked_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (blocker_id) REFERENCES users(id),
            FOREIGN KEY (blocked_id) REFERENCES users(id)
        )
    ''')

    # Уникальная пара blocker_id + blocked_id
    try:
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_unique ON blocked_users(blocker_id, blocked_id)')
    except sqlite3.OperationalError:
        pass
    
    # Проверяем структуру таблицы messages и исправляем, если нужно
    cursor.execute("PRAGMA table_info(messages)")
    columns = cursor.fetchall()
    message_col = None
    for col in columns:
        if col[1] == 'message':
            message_col = col
            break
    
    # Если поле message имеет ограничение NOT NULL, пересоздаем таблицу
    if message_col and message_col[3] == 1:  # 1 означает NOT NULL
        try:
            # Создаем новую таблицу с правильной структурой
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id INTEGER NOT NULL,
                    receiver_id INTEGER NOT NULL,
                    message TEXT,
                    image_path TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (sender_id) REFERENCES users(id),
                    FOREIGN KEY (receiver_id) REFERENCES users(id)
                )
            ''')
            
            # Копируем данные из старой таблицы
            cursor.execute('''
                INSERT INTO messages_new (id, sender_id, receiver_id, message, image_path, created_at)
                SELECT id, sender_id, receiver_id, message, COALESCE(image_path, NULL), created_at
                FROM messages
            ''')
            
            # Удаляем старую таблицу и переименовываем новую
            cursor.execute('DROP TABLE messages')
            cursor.execute('ALTER TABLE messages_new RENAME TO messages')
            conn.commit()
        except sqlite3.OperationalError as e:
            # Если что-то пошло не так, откатываем изменения
            conn.rollback()
            print(f"Предупреждение: не удалось обновить структуру таблицы messages: {e}")
    
    conn.commit()
    conn.close()
    print(f"База данных {DB_NAME} инициализирована")

def hash_password(password):
    """Хеширование пароля с использованием bcrypt"""
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
    return password_hash.decode('utf-8')

def verify_password(password, password_hash):
    """Проверка пароля"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))

def register_user(phone, password, username=None):
    """Регистрация нового пользователя.
    
    Возвращает кортеж (user_id, error_code), где:
    - user_id: ID созданного пользователя или None
    - error_code: None, 'phone_exists' или 'username_exists'
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Проверка существования пользователя по номеру телефона
        cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
        if cursor.fetchone():
            conn.close()
            return None, 'phone_exists'
        
        # Проверка существования пользователя по имени пользователя
        if username:
            cursor.execute('SELECT id FROM users WHERE username = ?', (username.strip(),))
            if cursor.fetchone():
                conn.close()
                return None, 'username_exists'
        
        # Хеширование пароля
        password_hash = hash_password(password)
        
        # Генерируем уникальный user_id из 8 символов
        while True:
            new_user_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            cursor.execute('SELECT id FROM users WHERE user_id = ?', (new_user_id,))
            if not cursor.fetchone():
                break
        
        # Определяем, будет ли пользователь админом (первый зарегистрированный пользователь)
        cursor.execute('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1')
        row = cursor.fetchone()
        is_admin = 1 if row and row['cnt'] == 0 else 0

        # Вставка нового пользователя
        cursor.execute(
            'INSERT INTO users (phone, password_hash, user_id, username, is_admin) VALUES (?, ?, ?, ?, ?)',
            (phone, password_hash, new_user_id, username.strip() if username else None, is_admin)
        )
        
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return user_id, None
        
    except sqlite3.IntegrityError:
        conn.close()
        # На всякий случай, если сработало ограничение уникальности
        return None, 'phone_exists'
    except Exception as e:
        conn.close()
        raise e

def authenticate_user(phone, password):
    """Аутентификация пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, phone, password_hash FROM users WHERE phone = ?', (phone,))
    user = cursor.fetchone()
    conn.close()
    
    if user and verify_password(password, user['password_hash']):
        result = {
            'id': user['id'],
            'phone': user['phone']
        }
        # Обновляем время последней активности при успешном входе
        try:
            update_last_activity(user['id'])
        except Exception:
            # Не мешаем логину, если что-то пошло не так
            pass
        return result
    
    return None

def get_all_users(exclude_user_id):
    """Получение списка всех пользователей кроме текущего"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, phone, username FROM users WHERE id != ? ORDER BY phone LIMIT 50', (exclude_user_id,))
    users = cursor.fetchall()
    conn.close()
    
    return [{'id': user['id'], 'phone': user['phone'], 'username': user['username'] if user['username'] else None} for user in users]

def search_users_by_phone(exclude_user_id, search_query):
    """Поиск пользователей по номеру телефона"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Поиск по частичному совпадению номера
    search_pattern = f'%{search_query}%'
    
    # Отладка: проверяем, сколько всего пользователей в базе
    cursor.execute('SELECT COUNT(*) as count FROM users')
    total_users = cursor.fetchone()['count']
    print(f"Всего пользователей в базе: {total_users}, исключаем: {exclude_user_id}, ищем: '{search_pattern}'")
    
    cursor.execute(
        'SELECT id, phone, username FROM users WHERE id != ? AND phone LIKE ? ORDER BY phone LIMIT 20',
        (exclude_user_id, search_pattern)
    )
    users = cursor.fetchall()
    
    # Отладка: выводим найденных пользователей
    print(f"Найдено пользователей: {len(users)}")
    for user in users:
        print(f"  - ID: {user['id']}, Phone: {user['phone']}, Username: {user['username']}")
    
    conn.close()
    
    return [{'id': user['id'], 'phone': user['phone'], 'username': user['username'] if user['username'] else None} for user in users]

def search_users(exclude_user_id, search_query):
    """Поиск пользователей по нику ИЛИ номеру телефона."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        raw = (search_query or '').strip()
        if not raw:
            # Если строка поиска пустая — возвращаем список "предложенных" пользователей:
            # тех, кто ещё не добавлен в друзья и не являются текущим пользователем.
            cursor.execute(
                '''
                SELECT 
                    u.id,
                    u.phone,
                    u.username
                FROM users u
                LEFT JOIN friends f
                    ON f.user_id = ? AND f.friend_id = u.id
                WHERE u.id != ?
                  AND f.id IS NULL
                ORDER BY u.username IS NULL, u.username, u.phone
                LIMIT 20
                ''',
                (exclude_user_id, exclude_user_id)
            )
            rows = cursor.fetchall()
            return [
                {
                    'id': row['id'],
                    'phone': row['phone'],
                    'username': row['username'] if row['username'] else None,
                    'is_friend': False,
                }
                for row in rows
            ]
        
        phone_digits = ''.join(filter(str.isdigit, raw))
        username_pattern = f'%{raw}%' if raw else None
        phone_pattern = f'%{phone_digits}%' if phone_digits else None
        
        # Строим условия динамически (с явными alias таблицы users)
        where_clauses = ['u.id != ?']
        params = [exclude_user_id]
        
        if phone_pattern:
            where_clauses.append('u.phone LIKE ?')
            params.append(phone_pattern)
        if username_pattern:
            where_clauses.append('u.username LIKE ?')
            params.append(username_pattern)
        
        # Если нет валидных условий поиска, просто возвращаем пустой список
        if len(where_clauses) == 1:
            return []
        
        where_sql = ' AND (' + ' OR '.join(where_clauses[1:]) + ')'
        
        # Отладка
        cursor.execute('SELECT COUNT(*) as count FROM users')
        total_users = cursor.fetchone()['count']
        print(f"[search_users] Всего пользователей: {total_users}, исключаем: {exclude_user_id}, raw='{raw}', phone='{phone_digits}'")
        
        query = f'''
            SELECT 
                u.id, 
                u.phone, 
                u.username,
                CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END AS is_friend
            FROM users u
            LEFT JOIN friends f 
                ON f.user_id = ? AND f.friend_id = u.id
            WHERE {' AND '.join(where_clauses[:1])}{where_sql}
            ORDER BY u.username IS NULL, u.username, u.phone
            LIMIT 20
        '''
        # Первый параметр — id текущего пользователя для определения, кто уже в друзьях
        cursor.execute(query, (exclude_user_id, *params))
        users = cursor.fetchall()
        
        print(f"[search_users] Найдено пользователей: {len(users)}")
        for user in users:
            print(
                f"  - ID: {user['id']}, Phone: {user['phone']}, "
                f"Username: {user['username']}, IsFriend: {user['is_friend']}"
            )
        
        return [
            {
                'id': user['id'],
                'phone': user['phone'],
                'username': user['username'] if user['username'] else None,
                'is_friend': bool(user['is_friend']),
            }
            for user in users
        ]
    finally:
        conn.close()

def send_message(sender_id, receiver_id, message=None, image_path=None, reply_to_id=None):
    """Отправка сообщения"""
    # Если один из пользователей заблокировал другого, запрещаем отправку
    if is_user_blocked(sender_id, receiver_id):
        return None

    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        'INSERT INTO messages (sender_id, receiver_id, message, image_path, reply_to_id) VALUES (?, ?, ?, ?, ?)',
        (sender_id, receiver_id, message, image_path, reply_to_id)
    )
    
    message_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return message_id


    # конец send_message / get_messages, групповые сообщения удалены

def get_messages(user_id, other_user_id):
    """Получение сообщений между двумя пользователями"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, sender_id, receiver_id, message, image_path, reply_to_id, is_pinned, created_at, updated_at
        FROM messages
        WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        AND is_deleted = 0
        ORDER BY is_pinned DESC, created_at ASC
    ''', (user_id, other_user_id, other_user_id, user_id))
    
    messages = cursor.fetchall()
    conn.close()
    
    return [{
        'id': msg['id'],
        'sender_id': msg['sender_id'],
        'receiver_id': msg['receiver_id'],
        'message': msg['message'],
        'image_path': msg['image_path'],
        'reply_to_id': msg['reply_to_id'],
        'is_pinned': msg['is_pinned'],
        'created_at': msg['created_at'],
        'updated_at': msg['updated_at']
    } for msg in messages]

def update_message(message_id, user_id, new_message):
    """Обновление сообщения"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Проверяем, что сообщение принадлежит пользователю
    cursor.execute('SELECT sender_id FROM messages WHERE id = ?', (message_id,))
    msg = cursor.fetchone()
    
    if not msg or msg['sender_id'] != user_id:
        conn.close()
        return False
    
    cursor.execute(
        'UPDATE messages SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        (new_message, message_id)
    )
    
    conn.commit()
    conn.close()
    return True

def delete_message(message_id, user_id):
    """Удаление сообщения (мягкое удаление)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Проверяем, что сообщение принадлежит пользователю
    cursor.execute('SELECT sender_id FROM messages WHERE id = ?', (message_id,))
    msg = cursor.fetchone()
    
    if not msg or msg['sender_id'] != user_id:
        conn.close()
        return False
    
    cursor.execute(
        'UPDATE messages SET is_deleted = 1 WHERE id = ?',
        (message_id,)
    )
    
    conn.commit()
    conn.close()
    return True

def toggle_pin_message(message_id, user_id):
    """Закрепление/открепление сообщения"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Проверяем, что пользователь участвует в чате
    cursor.execute('SELECT sender_id, receiver_id FROM messages WHERE id = ?', (message_id,))
    msg = cursor.fetchone()
    
    if not msg or (msg['sender_id'] != user_id and msg['receiver_id'] != user_id):
        conn.close()
        return False
    
    # Получаем текущее состояние
    cursor.execute('SELECT is_pinned FROM messages WHERE id = ?', (message_id,))
    current = cursor.fetchone()
    new_pin_state = 1 if not current or current['is_pinned'] == 0 else 0
    
    cursor.execute(
        'UPDATE messages SET is_pinned = ? WHERE id = ?',
        (new_pin_state, message_id)
    )
    
    conn.commit()
    conn.close()
    return new_pin_state == 1

def forward_message(message_id, sender_id, receiver_id):
    """Пересылка сообщения"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Получаем оригинальное сообщение
    cursor.execute('SELECT message, image_path FROM messages WHERE id = ?', (message_id,))
    original = cursor.fetchone()
    
    if not original:
        conn.close()
        return None
    
    # Создаем новое сообщение с теми же данными
    new_message_id = send_message(sender_id, receiver_id, original['message'], original['image_path'])
    conn.close()
    return new_message_id

def get_message_by_id(message_id):
    """Получение сообщения по ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, sender_id, receiver_id, message, image_path, reply_to_id, is_pinned, created_at, updated_at
        FROM messages WHERE id = ? AND is_deleted = 0
    ''', (message_id,))
    
    msg = cursor.fetchone()
    conn.close()
    
    if msg:
        return {
            'id': msg['id'],
            'sender_id': msg['sender_id'],
            'receiver_id': msg['receiver_id'],
            'message': msg['message'],
            'image_path': msg['image_path'],
            'reply_to_id': msg['reply_to_id'],
            'is_pinned': msg['is_pinned'],
            'created_at': msg['created_at'],
            'updated_at': msg['updated_at']
        }
    return None

def get_user_by_id(user_id):
    """Получение пользователя по ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, phone, user_id, username, avatar_path, last_activity FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {
            'id': user['id'], 
            'phone': user['phone'],
            'user_id': user['user_id'],
            'username': user['username'],
            'avatar_path': user['avatar_path'],
            'last_activity': user['last_activity'],
        }
    return None

def get_current_user_profile(user_id):
    """Получение профиля текущего пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, phone, user_id, username, avatar_path, last_activity, is_admin FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {
            'id': user['id'],
            'phone': user['phone'],
            'user_id': user['user_id'],
            'username': user['username'] if user['username'] else None,
            'avatar_path': user['avatar_path'],
            'last_activity': user['last_activity'],
            'is_admin': bool(user['is_admin'])
        }
    return None

def is_username_taken(username, exclude_user_id=None):
    """Проверка, занято ли имя пользователя.
    
    Если передан exclude_user_id, исключает этого пользователя из проверки
    (для обновления собственного профиля).
    """
    if not username:
        return False
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if exclude_user_id is not None:
            cursor.execute(
                'SELECT id FROM users WHERE username = ? AND id != ?',
                (username.strip(), exclude_user_id)
            )
        else:
            cursor.execute('SELECT id FROM users WHERE username = ?', (username.strip(),))
        exists = cursor.fetchone() is not None
        conn.close()
        return exists
    except Exception:
        conn.close()
        # В случае ошибки считаем, что имя занято, чтобы не допустить дублей
        return True

def add_friend(user_id, friend_id):
    """Добавление пользователя в друзья (односторонняя связь user_id -> friend_id)."""
    if not user_id or not friend_id or user_id == friend_id:
        return False, 'invalid'
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, что такой пользователь существует
        cursor.execute('SELECT id FROM users WHERE id = ?', (friend_id,))
        if not cursor.fetchone():
            conn.close()
            return False, 'not_found'
        
        cursor.execute(
            'INSERT INTO friends (user_id, friend_id) VALUES (?, ?)',
            (user_id, friend_id)
        )
        conn.commit()
        conn.close()
        return True, None
    except sqlite3.IntegrityError:
        conn.close()
        # Уже есть такая запись
        return False, 'exists'
    except Exception:
        conn.close()
        return False, 'error'

def remove_friend(user_id, friend_id):
    """Удаление пользователя из друзей."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'DELETE FROM friends WHERE user_id = ? AND friend_id = ?',
            (user_id, friend_id)
        )
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False

def get_friends(user_id):
    """Получение списка друзей пользователя."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id, u.phone, u.user_id, u.username, u.avatar_path, u.last_activity
        FROM friends f
        JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = ?
        ORDER BY u.username IS NULL, u.username, u.phone
    ''', (user_id,))
    rows = cursor.fetchall()
    conn.close()

    result = []
    for row in rows:
        # Не показываем в списке друзей, если есть блокировка в любую сторону
        if is_user_blocked(user_id, row['id']):
            continue
        result.append({
            'id': row['id'],
            'phone': row['phone'],
            'user_id': row['user_id'],
            'username': row['username'] if row['username'] else None,
            'avatar_path': row['avatar_path'],
            'last_activity': row['last_activity']
        })
    return result

def update_user_profile(user_id, username=None):
    """Обновление профиля пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        if username is not None:
            cursor.execute('UPDATE users SET username = ? WHERE id = ?', (username.strip() if username else None, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        conn.close()
        raise e

def update_user_avatar(user_id, avatar_path):
    """Обновление аватарки пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET avatar_path = ? WHERE id = ?', (avatar_path, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False

def get_user_chats(user_id):
    """Получение списка пользователей, с которыми есть переписка, отсортированных по времени последнего сообщения"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Оптимизированный запрос: получаем всех пользователей с перепиской и их последние сообщения за один запрос
    cursor.execute('''
        SELECT 
            u.id,
            u.phone,
            u.username,
            u.avatar_path,
            u.last_activity,
            m.message as last_message,
            m.image_path as last_image_path,
            m.created_at as last_message_time,
            m.sender_id as last_message_sender_id
        FROM users u
        INNER JOIN (
            SELECT 
                CASE 
                    WHEN sender_id = ? THEN receiver_id
                    ELSE sender_id
                END as other_user_id,
                MAX(created_at) as max_time
            FROM messages
            WHERE sender_id = ? OR receiver_id = ?
            GROUP BY other_user_id
        ) latest ON u.id = latest.other_user_id
        INNER JOIN messages m ON (
            (m.sender_id = ? AND m.receiver_id = u.id) OR 
            (m.sender_id = u.id AND m.receiver_id = ?)
        ) AND m.created_at = latest.max_time
        WHERE u.id != ?
        ORDER BY m.created_at DESC
    ''', (user_id, user_id, user_id, user_id, user_id, user_id))
    
    chats = cursor.fetchall()
    
    result = []
    for chat in chats:
        # Пропускаем чаты, где есть блокировка в любую сторону
        if is_user_blocked(user_id, chat['id']):
            continue
        last_msg_text = chat['last_message'] if chat['last_message'] else None
        if not last_msg_text and chat.get('last_image_path'):
            last_msg_text = '📷 Фото'
        
        result.append({
            'id': chat['id'],
            'phone': chat['phone'],
            'username': chat['username'] if chat['username'] else None,
            'avatar_path': chat['avatar_path'],
            'last_message': last_msg_text,
            'last_message_time': chat['last_message_time'] if chat['last_message_time'] else None,
            'last_message_sender_id': chat['last_message_sender_id'] if chat['last_message_sender_id'] else None,
            'last_activity': chat['last_activity']
        })
    
    conn.close()
    return result


def update_last_activity(user_id):
    """Обновление времени последней активности пользователя."""
    if not user_id:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?', (user_id,))
        conn.commit()
    finally:
        conn.close()


def block_user(user_id, blocked_id):
    """Заблокировать пользователя (user_id блокирует blocked_id)."""
    if not user_id or not blocked_id or user_id == blocked_id:
        return False, 'invalid'

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, что такой пользователь существует
        cursor.execute('SELECT id FROM users WHERE id = ?', (blocked_id,))
        if not cursor.fetchone():
            conn.close()
            return False, 'not_found'

        cursor.execute(
            'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)',
            (user_id, blocked_id)
        )
        conn.commit()
        conn.close()
        return True, None
    except sqlite3.IntegrityError:
        conn.close()
        return False, 'already_blocked'
    except Exception:
        conn.close()
        return False, 'error'


def unblock_user(user_id, blocked_id):
    """Разблокировать пользователя."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
            (user_id, blocked_id)
        )
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False


def is_user_blocked(user_id, other_user_id):
    """Проверка, есть ли блокировка между двумя пользователями в любую сторону."""
    if not user_id or not other_user_id:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT 1
        FROM blocked_users
        WHERE (blocker_id = ? AND blocked_id = ?)
           OR (blocker_id = ? AND blocked_id = ?)
        LIMIT 1
        ''',
        (user_id, other_user_id, other_user_id, user_id)
    )
    exists = cursor.fetchone() is not None
    conn.close()
    return exists


def get_block_status(user_id, other_user_id):
    """Статус блокировки между пользователями.

    Возвращает словарь:
    - blocked_by_me: я заблокировал другого
    - blocked_me: другой заблокировал меня
    """
    if not user_id or not other_user_id:
        return {'blocked_by_me': False, 'blocked_me': False}

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT blocker_id, blocked_id
        FROM blocked_users
        WHERE (blocker_id = ? AND blocked_id = ?)
           OR (blocker_id = ? AND blocked_id = ?)
        ''',
        (user_id, other_user_id, other_user_id, user_id)
    )
    rows = cursor.fetchall()
    conn.close()

    blocked_by_me = any(row['blocker_id'] == user_id and row['blocked_id'] == other_user_id for row in rows)
    blocked_me = any(row['blocker_id'] == other_user_id and row['blocked_id'] == user_id for row in rows)
    return {'blocked_by_me': blocked_by_me, 'blocked_me': blocked_me}


def get_all_users_admin():
    """Получение полного списка пользователей для админки."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, phone, user_id, username, avatar_path, created_at, last_activity, is_admin
        FROM users
        ORDER BY created_at ASC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            'id': row['id'],
            'phone': row['phone'],
            'user_id': row['user_id'],
            'username': row['username'] if row['username'] else None,
            'avatar_path': row['avatar_path'],
            'created_at': row['created_at'],
            'last_activity': row['last_activity'],
            'is_admin': bool(row['is_admin']),
        }
        for row in rows
    ]


def is_user_admin(user_id):
    """Проверка, является ли пользователь админом."""
    if not user_id:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT is_admin FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return bool(row and row['is_admin'])
