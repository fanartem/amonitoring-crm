import React, { useState, useEffect } from 'react';

export default function Approvals() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Загружаем список при открытии страницы
  useEffect(() => {
    fetchPendingUsers();
  }, []);

  const fetchPendingUsers = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('http://127.0.0.1:8000/admin/pending-users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить список заявок на регистрацию');
      }

      const data = await response.json();
      setPendingUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Функция одобрения пользователя
  const handleApprove = async (userId) => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`http://127.0.0.1:8000/admin/approve-user/${userId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Ошибка при одобрении');
      }

      // Если успешно — удаляем пользователя из списка на экране
      setPendingUsers(pendingUsers.filter(user => user.id !== userId));
      alert('Сотрудник успешно одобрен!');
      
    } catch (err) {
      alert(err.message);
    }
  };

  // Помощник для перевода ролей на русский
  const translateRole = (role) => {
    const roles = {
      'ADMIN': 'Администратор',
      'MANAGER': 'Менеджер',
      'SENIOR_TECHNICIAN': 'Старший техник',
      'TECHNICIAN': 'Техник'
    };
    return roles[role] || role;
  };

  return (
    <div className="section-inner employees-inner" style={{ padding: '20px' }}>
      <h2 className="section-title">Одобрение сотрудников</h2>
      <p className="emp-hint">Пользователи, зарегистрировавшиеся самостоятельно и ожидающие одобрения.</p>

      {loading ? (
        <div style={{ padding: '20px', color: '#888' }}>Загрузка...</div>
      ) : error ? (
        <div style={{ padding: '20px', color: '#c53030' }}>{error}</div>
      ) : pendingUsers.length === 0 ? (
        <div className="dash-empty visible" style={{ display: 'block' }}>
          Нет заявок на регистрацию
        </div>
      ) : (
        <div className="approval-list">
          {pendingUsers.map(user => (
            <div key={user.id} className="approval-card">
              <div className="approval-info">
                <div className="approval-name">{user.name}</div>
                <div className="approval-meta">
                  {user.email} · {user.created_at || 'Дата не указана'}
                </div>
                <span className="emp-role-badge">
                  {translateRole(user.role)}
                </span>
              </div>
              <div className="approval-actions">
                <button 
                  className="approve-btn" 
                  onClick={() => handleApprove(user.id)}
                >
                  ✓ Одобрить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}