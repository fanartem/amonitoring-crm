import React, { useState, useEffect } from 'react';

export default function Home() {
  const [requests, setRequests] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Загружаем данные при открытии главной страницы
  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('http://127.0.0.1:8000/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setRequests(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки заявок:', err);
    } finally {
      setLoading(false);
    }
  };

  // Умный поиск (фильтрует данные, которые уже загружены)
  const filteredRequests = requests.filter(req => {
    const searchString = `${req.client_name} ${req.brand} ${req.model} ${req.status}`.toLowerCase();
    return searchString.includes(searchTerm.toLowerCase());
  });

  // Помощники для бейджей статуса (цвета и текст)
  const getStatusClass = (status) => {
    const map = { 'NEW': 'st-waiting', 'IN_PROGRESS': 'st-process', 'DONE': 'st-done', 'CANCELLED': 'st-cancelled' };
    return map[status] || 'st-waiting';
  };
  const translateStatus = (status) => {
    const map = { 'NEW': 'В ожидании', 'IN_PROGRESS': 'В процессе установки', 'DONE': 'Работы завершены', 'CANCELLED': 'Отмена заявки' };
    return map[status] || status;
  };

  // Форматирование даты
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="home-dashboard" style={{ background: '#f2f2f2' }}>
      
      {/* ПАНЕЛЬ ИНСТРУМЕНТОВ (Поиск и кнопки) */}
      <div className="dashboard-toolbar">
        <div className="dash-search-wrap">
          <svg className="dash-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            className="dash-search-input" 
            placeholder="Поиск по клиенту, авто, статусу…" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="home-create-btn">+ Создать заявку</button>
          <button className="export-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Excel
          </button>
        </div>
      </div>

      {/* ТАБЛИЦА */}
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Клиент</th>
              <th>Авто</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Загрузка...</td></tr>
            ) : filteredRequests.length === 0 ? (
              <tr><td colSpan="4" className="dash-empty visible" style={{ display: 'table-cell' }}>Ничего не найдено</td></tr>
            ) : (
              filteredRequests.map(req => (
                <tr key={req.id}>
                  <td>{formatDate(req.created_at)}</td>
                  <td>
                    {req.client_name || '—'}
                    {req.phone && <div style={{ fontSize: '11px', color: '#888' }}>{req.phone}</div>}
                  </td>
                  <td>
                    {req.brand} {req.model}
                    {req.plate_number && <div style={{ fontSize: '11px', color: '#888' }}>{req.plate_number}</div>}
                  </td>
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

    </div>
  );
}