import React, { useState, useEffect } from 'react';
import '../styles/Requests.css';
import RequestDetailModal from './RequestDetailModal';

const statusLabels = { 
  'NEW': 'В ожидании', 
  'IN_PROGRESS': 'В процессе', 
  'COMPLETED': 'Завершено', 
  'CANCELLED': 'Отменено', 
  'DONE': 'Завершено' 
};

const statusClasses = { 
  'NEW': 'status-new', 
  'IN_PROGRESS': 'status-progress', 
  'COMPLETED': 'status-done', 
  'CANCELLED': 'status-cancelled', 
  'DONE': 'status-done' 
};

const formatDate = (dateString) => {
  if (!dateString) return '—';
  const d = new Date(dateString);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
};

export default function DashboardTable() {
  const [stats, setStats] = useState({ total: 0, new: 0, progress: 0, unpaid: 0, stock: 0 });
  const [recentRequests, setRecentRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const headers = { 'Authorization': `Bearer ${token}` };

      // 1. Загружаем статистику (если бэкенд уже поддерживает этот роут)
      // Если роута /dashboard/stats пока нет, этот блок просто не сломает страницу
      try {
        const statsRes = await fetch('http://127.0.0.1:8000/dashboard/stats', { headers });
        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats({
            total: data.requests?.total || 0,
            new: data.requests?.new || 0,
            progress: data.requests?.progress || 0,
            unpaid: data.requests?.unpaid || 0,
            stock: data.stock_count || 0
          });
        }
      } catch (e) {
        console.log('Статистика пока недоступна', e);
      }

      // 2. Загружаем последние заявки
      const reqRes = await fetch('http://127.0.0.1:8000/requests', { headers });
      if (reqRes.ok) {
        const allReqs = await reqRes.json();
        // Берем только 5 самых свежих заявок для главной
        setRecentRequests(allReqs.slice(0, 5)); 
      }
    } catch (err) {
      console.error('Ошибка Dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="requests-page-container" style={{ padding: '25px' }}>
      
      <div className="clients-header-bar" style={{ marginBottom: '25px' }}>
        <h2>Рабочий стол</h2>
        <span className="subtitle-text">Оперативная сводка и последние заявки</span>
      </div>

      {/* Блок статистики (Виджеты) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        <div className="info-card" style={{ margin: 0, textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', marginBottom: '10px' }}>Всего заявок</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#333' }}>{stats.total}</div>
        </div>
        <div className="info-card" style={{ margin: 0, textAlign: 'center', padding: '20px', borderLeft: '4px solid #fdd835' }}>
          <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', marginBottom: '10px' }}>Новые</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fbc02d' }}>{stats.new}</div>
        </div>
        <div className="info-card" style={{ margin: 0, textAlign: 'center', padding: '20px', borderLeft: '4px solid #43a047' }}>
          <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', marginBottom: '10px' }}>В работе</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#5e9424' }}>{stats.progress}</div>
        </div>
        <div className="info-card" style={{ margin: 0, textAlign: 'center', padding: '20px', borderLeft: '4px solid #c62828' }}>
          <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', marginBottom: '10px' }}>Не оплачено</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#c62828' }}>{stats.unpaid}</div>
        </div>
        <div className="info-card" style={{ margin: 0, textAlign: 'center', padding: '20px', borderLeft: '4px solid #1976d2' }}>
          <div style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase', marginBottom: '10px' }}>Склад (В наличии)</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#1976d2' }}>{stats.stock}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Свежие заявки</h3>
      </div>

      {/* Список заявок в виде красивых карточек */}
      <div className="requests-list">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Загрузка данных...</div>
        ) : recentRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Заявок пока нет</div>
        ) : (
          recentRequests.map(req => (
            <div key={req.id} className="request-card" style={{ cursor: 'default', position: 'relative' }}>
              
              <div className="card-column">
                <div className="card-item"><span className="card-label">Клиент</span><span className="card-value">{req.client_name || 'Не указано'}</span></div>
                <div className="card-item"><span className="card-label">Статус</span><div className={`status-badge ${statusClasses[req.status] || 'status-new'}`}>{statusLabels[req.status] || req.status}</div></div>
              </div>

              <div className="card-column">
                <div className="card-item"><span className="card-label">Авто</span><span className="card-value">{req.brand} {req.model} <span style={{color: '#888', fontSize: '12px'}}>({req.plate_number || 'б/н'})</span></span></div>
                <div className="card-item"><span className="card-label">Город</span><span className="card-value">{req.city || 'Не указан'}</span></div>
              </div>

              <div className="card-column">
                <div className="card-item">
                  <span className="card-label">Оборудование</span>
                  <span className="card-value" style={{fontSize: '13px'}}>
                    {req.work_type === 'INSTALLATION' 
                      ? `${req.has_blocking ? 'Блок.' : 'Без блок.'} • ${req.has_beacon ? 'Маяк' : 'Без маяка'}`
                      : <span style={{ color: '#aaa' }}>—</span>}
                  </span>
                </div>
                <div className="card-item"><span className="card-label">Формат</span><span className="card-value">{req.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе'}</span></div>
              </div>

              <div className="card-column">
                <div className="card-item"><span className="card-label">Дата</span><span className="card-value">{formatDate(req.created_at)}</span></div>
                <div className="card-item">
                  <span className="card-label">Оплата</span>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                    <div className={`status-badge ${req.is_paid ? 'status-progress' : 'status-new'}`} style={{padding: '2px 10px', fontSize: '11px'}}>
                      {req.is_paid ? 'Оплачено' : 'Ожидает оплаты'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card-actions-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'absolute', top: '15px', right: '15px' }}>
                <button 
                  className="btn-details" 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setSelectedRequestId(req.id); 
                  }}
                >
                  Детали
                </button>
              </div>

            </div>
          ))
        )}
      </div>

      <RequestDetailModal 
        isOpen={!!selectedRequestId} 
        requestId={selectedRequestId} 
        onClose={() => setSelectedRequestId(null)} 
        onUpdated={() => fetchDashboardData()} 
      />
    </div>
  );
}