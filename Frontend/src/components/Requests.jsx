import React, { useState, useEffect } from 'react';
import CreateRequestModal from './CreateRequestModal'; // <-- Импорт модального окна

export default function Requests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Переменная, которая отвечает за то, открыто окно или нет
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('http://127.0.0.1:8000/requests', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить заявки');
      }

      const data = await response.json();
      setRequests(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusClass = (status) => {
    const map = {
      'NEW': 'st-waiting',
      'IN_PROGRESS': 'st-process',
      'DONE': 'st-done',
      'CANCELLED': 'st-cancelled'
    };
    return map[status] || 'st-waiting';
  };

  const translateStatus = (status) => {
    const map = {
      'NEW': 'В ожидании',
      'IN_PROGRESS': 'В процессе установки',
      'DONE': 'Работы завершены',
      'CANCELLED': 'Отмена заявки'
    };
    return map[status] || status;
  };

  return (
    <div className="home-dashboard" style={{ background: '#f2f2f2' }}>
      <div className="dashboard-toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>Все заявки</h2>
        
        {/* КНОПКА: При клике меняем isModalOpen на true */}
        <button className="create-btn" onClick={() => setIsModalOpen(true)}>
          + Создать заявку
        </button>
      </div>

      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Клиент</th>
              <th>Авто</th>
              <th>Тип работ</th>
              <th>Формат</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
                  Загрузка заявок...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: '#c53030' }}>
                  {error}
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan="6" className="dash-empty visible" style={{ display: 'table-cell' }}>
                  Нет заявок
                </td>
              </tr>
            ) : (
              requests.map(req => (
                <tr key={req.id}>
                  <td>#{req.id}</td>
                  <td>{req.client_name || '—'} <br/><span style={{fontSize: '11px', color: '#888'}}>{req.phone}</span></td>
                  <td>{req.brand} {req.model} <br/><span style={{fontSize: '11px', color: '#888'}}>{req.plate_number}</span></td>
                  <td>{req.work_type === 'INSTALLATION' ? 'Установка' : req.work_type}</td>
                  <td>{req.visit_type === 'FIELD' ? 'Выезд' : 'В сервисе'}</td>
                  <td>
                    <span className={`st-badge ${getStatusClass(req.status)}`}>
                      {translateStatus(req.status)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* САМО МОДАЛЬНОЕ ОКНО */}
      <CreateRequestModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onCreated={fetchRequests} 
      />
      
    </div>
  );
}