from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from database import (
    init_db,
    register_user,
    authenticate_user,
    get_all_users,
    send_message,
    get_messages,
    get_user_by_id,
    search_users_by_phone,
    get_current_user_profile,
    update_user_profile,
    update_message,
    delete_message,
    toggle_pin_message,
)
import os
from werkzeug.utils import secure_filename
from datetime import datetime
import uuid

app = Flask(__name__)
app.secret_key = os.urandom(24)  # Секретный ключ для сессий

# Настройки для загрузки файлов
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB максимум

# Создаем папку для загрузок, если её нет
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """Проверка расширения файла"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Инициализация базы данных при запуске
init_db()


@app.before_request
def touch_user_activity():
    """Обновляем время последней активности для авторизованных пользователей."""
    user_id = session.get('user_id')
    if user_id:
        try:
            update_last_activity(user_id)
        except Exception:
            # Не блокируем запросы из‑за ошибок обновления активности
            pass

@app.route('/')
def index():
    """Главная страница - редирект на авторизацию"""
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/login')
def login():
    """Страница авторизации"""
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/register')
def register():
    """Страница регистрации"""
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('register.html')

@app.route('/api/register', methods=['POST'])
def api_register():
    """API endpoint для регистрации"""
    try:
        data = request.get_json()
        phone = data.get('phone', '').strip()
        password = data.get('password', '').strip()
        username = data.get('username', '').strip() if data.get('username') else None

        # Валидация
        if not phone or not password or not username:
            return jsonify({'success': False, 'message': 'Номер телефона, пароль и имя пользователя обязательны'}), 400

        # Простая валидация номера телефона (только цифры, минимум 10 символов)
        if not phone.isdigit() or len(phone) < 10:
            return jsonify({'success': False, 'message': 'Некорректный номер телефона'}), 400

        if len(password) < 6:
            return jsonify({'success': False, 'message': 'Пароль должен содержать минимум 6 символов'}), 400

        # Валидация имени пользователя
        if len(username) < 3:
            return jsonify({'success': False, 'message': 'Имя пользователя должно содержать минимум 3 символа'}), 400
        if len(username) > 30:
            return jsonify({'success': False, 'message': 'Имя пользователя не может быть длиннее 30 символов'}), 400
        if ' ' in username:
            return jsonify({'success': False, 'message': 'Имя пользователя не должно содержать пробелы'}), 400

        # Проверка на уникальность имени пользователя
        if is_username_taken(username):
            return jsonify({'success': False, 'message': 'Имя пользователя уже занято'}), 400

        # Регистрация пользователя
        user_id, error = register_user(phone, password, username)

        if user_id and not error:
            session['user_id'] = user_id
            session['phone'] = phone
            return jsonify({'success': True, 'message': 'Регистрация успешна', 'redirect': '/dashboard'})
        else:
            if error == 'username_exists':
                return jsonify({'success': False, 'message': 'Имя пользователя уже занято'}), 400
            return jsonify({'success': False, 'message': 'Пользователь с таким номером уже существует'}), 400

    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/login', methods=['POST'])
def api_login():
    """API endpoint для авторизации"""
    try:
        data = request.get_json()
        phone = data.get('phone', '').strip()
        password = data.get('password', '').strip()

        # Валидация
        if not phone or not password:
            return jsonify({'success': False, 'message': 'Номер телефона и пароль обязательны'}), 400

        # Аутентификация
        user = authenticate_user(phone, password)

        if user:
            session['user_id'] = user['id']
            session['phone'] = user['phone']
            return jsonify({'success': True, 'message': 'Вход выполнен успешно', 'redirect': '/dashboard'})
        else:
            return jsonify({'success': False, 'message': 'Неверный номер телефона или пароль'}), 401

    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/logout', methods=['POST'])
def api_logout():
    """API endpoint для выхода"""
    session.clear()
    return jsonify({'success': True, 'redirect': '/login'})

@app.route('/dashboard')
def dashboard():
    """Страница после успешной авторизации"""
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user_id = session.get('user_id')
    return render_template(
        'dashboard.html',
        phone=session.get('phone'),
        user_id=user_id,
        is_admin=is_user_admin(user_id)
    )


@app.route('/admin')
def admin_panel():
    """Простая админ-панель для просмотра пользователей."""
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user_id = session.get('user_id')
    if not is_user_admin(user_id):
        return redirect(url_for('dashboard'))

    users = get_all_users_admin()
    return render_template('admin.html', users=users)

@app.route('/api/chats', methods=['GET'])
def api_get_chats():
    """API endpoint для получения списка чатов (пользователей с перепиской)"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    try:
        chats = get_user_chats(session['user_id'])
        return jsonify({'success': True, 'chats': chats})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/users/search', methods=['GET'])
def api_search_users():
    """API endpoint для поиска пользователей по нику или номеру телефона"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        search_query = request.args.get('q', '').strip()
        users = search_users(session['user_id'], search_query)
        print(f"Поиск пользователей: запрос='{search_query}', найдено={len(users)}")  # Отладка
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        print(f"Ошибка поиска пользователей: {str(e)}")  # Отладка
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages', methods=['GET'])
def api_get_messages():
    """API endpoint для получения сообщений с другим пользователем"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        other_user_id = request.args.get('user_id', type=int)
        if not other_user_id:
            return jsonify({'success': False, 'message': 'ID пользователя не указан'}), 400
        
        messages = get_messages(session['user_id'], other_user_id)
        return jsonify({'success': True, 'messages': messages})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages', methods=['POST'])
def api_send_message():
    """API endpoint для отправки сообщения"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    try:
        receiver_id = request.form.get('receiver_id', type=int)
        message = request.form.get('message', '').strip()

        if not receiver_id:
            return jsonify({'success': False, 'message': 'ID получателя не указан'}), 400

        # Проверяем, есть ли файл
        image_path = None
        if 'image' in request.files:
            file = request.files['image']
            if file and file.filename and allowed_file(file.filename):
                # Генерируем уникальное имя файла
                filename = f"{uuid.uuid4()}_{secure_filename(file.filename)}"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                image_path = filename

        # Сообщение или изображение должны быть
        if not message and not image_path:
            return jsonify({'success': False, 'message': 'Сообщение или изображение обязательны'}), 400

        reply_to_id = request.form.get('reply_to_id', type=int)

        # Личные сообщения
        if is_user_blocked(session['user_id'], receiver_id):
            return jsonify({'success': False, 'message': 'Невозможно отправить сообщение: один из пользователей заблокирован'}), 403
        message_id = send_message(session['user_id'], receiver_id, message if message else None, image_path, reply_to_id)
        if not message_id:
            return jsonify({'success': False, 'message': 'Невозможно отправить сообщение: один из пользователей заблокирован'}), 403
        return jsonify({'success': True, 'message_id': message_id, 'image_path': image_path})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Отдача загруженных файлов"""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/profile/avatar', methods=['POST'])
def api_update_avatar():
    """API endpoint для обновления аватара профиля"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        if 'avatar' not in request.files:
            return jsonify({'success': False, 'message': 'Файл не передан'}), 400
        
        file = request.files['avatar']
        if not file or not file.filename:
            return jsonify({'success': False, 'message': 'Файл не выбран'}), 400
        
        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({'success': False, 'message': 'Недопустимый формат файла'}), 400
        
        # Удаляем старый аватар, если был
        profile = get_current_user_profile(session['user_id'])
        old_avatar = profile.get('avatar_path') if profile else None
        if old_avatar:
            old_path = os.path.join(app.config['UPLOAD_FOLDER'], old_avatar)
            try:
                if os.path.exists(old_path):
                    os.remove(old_path)
            except OSError:
                pass
        
        # Сохраняем новый файл
        filename = f"avatar_{session['user_id']}_{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(filename))
        file.save(filepath)
        
        if not update_user_avatar(session['user_id'], filename):
            return jsonify({'success': False, 'message': 'Не удалось сохранить аватар'}), 500
        
        new_profile = get_current_user_profile(session['user_id'])
        return jsonify({
            'success': True,
            'profile': new_profile,
            'avatar_url': url_for('uploaded_file', filename=filename)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages/<int:message_id>', methods=['PUT'])
def api_update_message(message_id):
    """API endpoint для обновления сообщения"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        data = request.get_json()
        new_message = data.get('message', '').strip()
        
        if not new_message:
            return jsonify({'success': False, 'message': 'Сообщение не может быть пустым'}), 400
        
        if update_message(message_id, session['user_id'], new_message):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'message': 'Сообщение не найдено или нет прав на редактирование'}), 403
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages/<int:message_id>', methods=['DELETE'])
def api_delete_message(message_id):
    """API endpoint для удаления сообщения"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        if delete_message(message_id, session['user_id']):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'message': 'Сообщение не найдено или нет прав на удаление'}), 403
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages/<int:message_id>/pin', methods=['POST'])
def api_toggle_pin(message_id):
    """API endpoint для закрепления/открепления сообщения"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        is_pinned = toggle_pin_message(message_id, session['user_id'])
        if is_pinned is not False:
            return jsonify({'success': True, 'is_pinned': is_pinned})
        else:
            return jsonify({'success': False, 'message': 'Сообщение не найдено или нет прав'}), 403
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages/<int:message_id>/forward', methods=['POST'])
def api_forward_message(message_id):
    """API endpoint для пересылки сообщения"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        data = request.get_json()
        receiver_id = data.get('receiver_id')
        
        if not receiver_id:
            return jsonify({'success': False, 'message': 'ID получателя не указан'}), 400
        
        new_message_id = forward_message(message_id, session['user_id'], receiver_id)
        if new_message_id:
            return jsonify({'success': True, 'message_id': new_message_id})
        else:
            return jsonify({'success': False, 'message': 'Сообщение не найдено'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/messages/<int:message_id>', methods=['GET'])
def api_get_message(message_id):
    """API endpoint для получения сообщения по ID"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        message = get_message_by_id(message_id)
        if message:
            # Проверяем, что пользователь участвует в чате
            if message['sender_id'] != session['user_id'] and message['receiver_id'] != session['user_id']:
                return jsonify({'success': False, 'message': 'Нет доступа'}), 403
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'success': False, 'message': 'Сообщение не найдено'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/user/<int:user_id>', methods=['GET'])
def api_get_user(user_id):
    """API endpoint для получения информации о пользователе"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        user = get_user_by_id(user_id)
        if user:
            return jsonify({'success': True, 'user': user})
        else:
            return jsonify({'success': False, 'message': 'Пользователь не найден'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/profile', methods=['GET'])
def api_get_profile():
    """API endpoint для получения профиля текущего пользователя"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        profile = get_current_user_profile(session['user_id'])
        if profile:
            return jsonify({'success': True, 'profile': profile})
        else:
            return jsonify({'success': False, 'message': 'Профиль не найден'}), 404
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/profile', methods=['PUT'])
def api_update_profile():
    """API endpoint для обновления профиля"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        data = request.get_json()
        username = data.get('username', '').strip() if data.get('username') else None
        
        if username and len(username) > 50:
            return jsonify({'success': False, 'message': 'Ник не может быть длиннее 50 символов'}), 400
        
        if username and is_username_taken(username, session['user_id']):
            return jsonify({'success': False, 'message': 'Имя пользователя уже занято'}), 400
        
        update_user_profile(session['user_id'], username)
        profile = get_current_user_profile(session['user_id'])
        return jsonify({'success': True, 'profile': profile})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/friends', methods=['GET'])
def api_get_friends():
    """API endpoint для получения списка друзей текущего пользователя"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        friends = get_friends(session['user_id'])
        return jsonify({'success': True, 'friends': friends})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/friends', methods=['POST'])
def api_add_friend():
    """API endpoint для добавления пользователя в друзья"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        data = request.get_json()
        friend_id = data.get('friend_id')
        if not friend_id:
            return jsonify({'success': False, 'message': 'ID пользователя не указан'}), 400
        
        success, error = add_friend(session['user_id'], int(friend_id))
        if success:
            return jsonify({'success': True, 'message': 'Пользователь добавлен в друзья'})
        else:
            if error == 'invalid':
                return jsonify({'success': False, 'message': 'Нельзя добавить себя в друзья'}), 400
            if error == 'not_found':
                return jsonify({'success': False, 'message': 'Пользователь не найден'}), 404
            if error == 'exists':
                return jsonify({'success': False, 'message': 'Пользователь уже в списке друзей'}), 400
            return jsonify({'success': False, 'message': 'Не удалось добавить в друзья'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

@app.route('/api/friends/<int:friend_id>', methods=['DELETE'])
def api_remove_friend(friend_id):
    """API endpoint для удаления пользователя из друзей"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401
    
    try:
        if remove_friend(session['user_id'], friend_id):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'message': 'Не удалось удалить из друзей'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500


@app.route('/api/block', methods=['POST'])
def api_block_user():
    """API endpoint для блокировки пользователя."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    try:
        data = request.get_json()
        target_id = data.get('user_id')
        if not target_id:
            return jsonify({'success': False, 'message': 'ID пользователя не указан'}), 400

        success, error = block_user(session['user_id'], int(target_id))
        if success:
            return jsonify({'success': True, 'message': 'Пользователь заблокирован'})
        else:
            if error == 'invalid':
                return jsonify({'success': False, 'message': 'Нельзя заблокировать себя'}), 400
            if error == 'not_found':
                return jsonify({'success': False, 'message': 'Пользователь не найден'}), 404
            if error == 'already_blocked':
                return jsonify({'success': True, 'message': 'Пользователь уже заблокирован'})
            return jsonify({'success': False, 'message': 'Не удалось заблокировать пользователя'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500


@app.route('/api/block/<int:other_user_id>', methods=['DELETE'])
def api_unblock_user(other_user_id):
    """API endpoint для разблокировки пользователя."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    try:
        if unblock_user(session['user_id'], other_user_id):
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'message': 'Не удалось разблокировать пользователя'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500


@app.route('/api/block/status', methods=['GET'])
def api_block_status():
    """API endpoint для получения статуса блокировки с пользователем."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Не авторизован'}), 401

    try:
        other_user_id = request.args.get('user_id', type=int)
        if not other_user_id:
            return jsonify({'success': False, 'message': 'ID пользователя не указан'}), 400

        status = get_block_status(session['user_id'], other_user_id)
        return jsonify({'success': True, 'status': status})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка сервера: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
