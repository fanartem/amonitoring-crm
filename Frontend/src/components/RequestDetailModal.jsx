import React, { useState, useEffect } from 'react';
import '../styles/Requests.css';

const getUserRole = () => {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload).role;
  } catch (error) { return null; }
};

const mapTypeToUI = (dbType) => {
  if (!dbType) return 'Физ. лицо';
  const t = String(dbType).toUpperCase();
  if (t === 'TOO' || t === 'ТОО') return 'ТОО';
  if (t === 'IP' || t === 'ИП') return 'ИП';
  return 'Физ. лицо';
};

export default function RequestDetailModal({ isOpen, onClose, requestId, onUpdated, initialTab = 'info', onEditClick }) {
  const [activeTab, setActiveTab] = useState(initialTab); 
  const [request, setRequest] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [technicians, setTechnicians] = useState([]);
  const [selectedTech, setSelectedTech] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const userRole = getUserRole();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && requestId) {
      setActiveTab(initialTab);
      fetchRequestDetails();
      fetchComments();
      if (userRole === 'ADMIN' || userRole === 'SENIOR_TECHNICIAN') {
        fetchTechnicians();
      }
    }
  }, [isOpen, requestId, initialTab]);

  useEffect(() => {
    if (request) {
      setSelectedTech(request.assigned_to ? request.assigned_to.toString() : '');
    }
  }, [request]);

  const fetchRequestDetails = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Не удалось загрузить данные заявки');
      
      const data = await res.json();
      setRequest(data.request);
      setHistory(data.history || []); 
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}/comments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (err) { console.error(err); }
  };

  const fetchTechnicians = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/users/technicians`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTechnicians(data);
      }
    } catch (err) { console.error(err); }
  };

  const handleStatusChange = async (e) => {
    const newStatus = e.target.value;
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Не удалось обновить статус');
      setRequest({ ...request, status: newStatus });
      fetchRequestDetails(); 
      onUpdated(); 
    } catch (err) { alert(err.message); }
  };

  const handlePaymentChange = async (e) => {
    const newIsPaid = e.target.value === 'true';
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ is_paid: newIsPaid })
      });
      if (!res.ok) throw new Error('Не удалось обновить статус оплаты');
      setRequest({ ...request, is_paid: newIsPaid });
      fetchRequestDetails(); 
      onUpdated(); 
    } catch (err) { alert(err.message); }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ request_id: requestId, message: newComment })
      });
      if (!res.ok) throw new Error('Не удалось отправить комментарий');
      setNewComment('');
      fetchComments(); 
    } catch (err) { alert(err.message); }
  };

  const handleAssign = async () => {
    try {
      const token = localStorage.getItem('access_token');
      // Если пусто — отправляем null (снятие монтажника)
      const techId = selectedTech ? parseInt(selectedTech, 10) : null;
      
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ technician_id: techId })
      });
      
      if (!res.ok) throw new Error('Ошибка при назначении/снятии сотрудника');
      
      // Выводим правильное уведомление
      if (!techId) alert('Монтажник успешно снят с заявки!');
      else alert(request.assigned_to ? 'Монтажник успешно заменен!' : 'Монтажник назначен!');
      
      fetchRequestDetails();
      onUpdated();
    } catch (err) { alert(err.message); }
  };

  // ФУНКЦИЯ УДАЛЕНИЯ ЗАЯВКИ
  const handleDeleteRequest = async () => {
    if (!window.confirm('Вы уверены, что хотите удалить эту заявку? Она будет перемещена в Корзину.')) return;
    
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${requestId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.text();
        throw new Error(errData || 'Ошибка при удалении заявки');
      }
      alert('Заявка удалена!');
      onUpdated(); // Обновляем список на главной
      onClose();   // Закрываем модалку
    } catch (err) {
      alert(err.message);
    }
  };

  const getTechName = (val) => {
    const strVal = String(val);
    if (!val || strVal === 'null' || strVal === 'None' || strVal.includes('NaN')) return 'Не назначен';
    
    const id = parseInt(strVal, 10);
    if (isNaN(id)) return strVal;
    
    const tech = technicians.find(t => t.id === id);
    return tech ? tech.name : `Сотрудник ID: ${id}`;
  };

  const renderHistoryMessage = (h) => {
    if (h.action === 'CREATED') return 'Заявка создана';
    if (h.action === 'STATUS_CHANGED') return `Статус изменен: ${h.old_value || '—'} → ${h.new_value}`;
    if (h.action === 'PAYMENT_CHANGED') return `Статус оплаты: ${h.new_value === 'true' ? 'Оплачено' : 'Ожидает оплаты'}`;
    
    if (h.action === 'ASSIGNED' || h.action === 'TECHNICIAN_ASSIGNED' || h.action === 'TECHNICIAN_CHANGED') {
      if (h.old_value && h.old_value !== 'null' && h.old_value !== 'None' && !String(h.old_value).includes('NaN')) {
        return `Монтажник изменен: ${getTechName(h.old_value)} → ${getTechName(h.new_value)}`;
      }
      return `Назначен монтажник: ${getTechName(h.new_value)}`;
    }
    return h.action;
  };

  if (!isOpen) return null;

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-window custom-detail-window" onClick={(e) => e.stopPropagation()}>
        
        <div className="modal-header">
          <span className="modal-title">Заявка — {request ? request.client_name : 'Загрузка...'}</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <div className="custom-tabs">
          <button className={`custom-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>Информация</button>
          <button className={`custom-tab ${activeTab === 'comments' ? 'active' : ''}`} onClick={() => setActiveTab('comments')}>Комментарии <span className="tab-badge">{comments.length}</span></button>
          <button className={`custom-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>История</button>
        </div>

        <div className="custom-body">
          {loading ? <div className="loading-state">Загрузка данных...</div> : error ? <div className="validation-banner visible">{error}</div> : request && (
            <>
              {activeTab === 'info' && (
                <div className="tab-content">
                  {userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN' && onEditClick && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '15px' }}>
                      <button className="btn-edit-request" onClick={() => onEditClick(request)}>✎ Изменить заявку</button>
                    </div>
                  )}

                  <div className="info-card">
                    <div className="info-card-title">Клиент</div>
                    <div className="info-row"><span className="info-key">Тип лица</span><span className="info-val" style={{color: '#5e9424', fontWeight: 'bold'}}>{mapTypeToUI(request.client_type || request.type || request.client?.type)}</span></div>
                    {['TOO', 'IP', 'ТОО', 'ИП'].includes(String(request.client_type || request.type || request.client?.type).toUpperCase()) && (
                      <div className="info-row"><span className="info-key">Наименование</span><span className="info-val">{request.company_name || request.client?.company_name || '—'}</span></div>
                    )}
                    <div className="info-row"><span className="info-key">ФИО</span><span className="info-val">{request.client_name || request.client?.name || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Телефон</span><span className="info-val">{request.phone || request.client?.phone || '—'}</span></div>
                  </div>

                  <div className="info-card">
                    <div className="info-card-title">Транспорт</div>
                    <div className="info-row"><span className="info-key">Тип техники</span><span className="info-val">{request.vehicle_type || request.car_type || request.vehicle?.type || 'Легковая'}</span></div>
                    <div className="info-row"><span className="info-key">Марка</span><span className="info-val">{request.brand || request.vehicle?.brand || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Модель</span><span className="info-val">{request.model || request.vehicle?.model || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Год выпуска</span><span className="info-val">{request.year || request.vehicle_year || request.vehicle?.year || '—'}</span></div>
                    <div className="info-row"><span className="info-key">VIN-код</span><span className="info-val">{request.vin || request.vehicle_vin || request.vehicle?.vin || '—'}</span></div>
                    <div className="info-row"><span className="info-key">Гос. номер</span><span className="info-val">{request.plate_number || request.vehicle?.plate_number || '—'}</span></div>
                  </div>

                  <div className="info-card">
                    <div className="info-card-title">Работы</div>
                    <div className="info-row"><span className="info-key">Город</span><span className="info-val">{request.city || 'Не указан'}</span></div>
                    <div className="info-row"><span className="info-key">Форма работы</span><span className="info-val">{request.work_type === 'INSTALLATION' ? 'Установка' : request.work_type === 'REMOVAL' ? 'Снятие' : 'Диагностика'}</span></div>
                    <div className="info-row"><span className="info-key">Формат</span><span className="info-val">{request.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе'}</span></div>
                    
                    {request.visit_type === 'ON_SITE' && (
                      <div className="info-row"><span className="info-key">Адрес выезда</span><span className="info-val" style={{color: '#c62828', fontWeight: 'bold'}}>{request.address || '—'}</span></div>
                    )}
                    
                    <div className="info-row"><span className="info-key">Дата выполнения</span><span className="info-val">{formatDate(request.created_at).split(' ')[0]}</span></div>
                    
                    <div className="info-row">
                      <span className="info-key">Статус оплаты</span>
                      <span className="info-val" style={{ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center' }}>
                        <span className={`status-badge ${request.is_paid ? 'status-progress' : 'status-new'}`} style={{padding: '2px 8px', fontSize: '11px', display: 'inline-block'}}>
                          {request.is_paid ? 'Оплачено' : 'Ожидает оплаты'}
                        </span>
                        {request.is_paid && request.paid_at && (
                          <span style={{fontSize: '12px', color: '#888'}}>
                            (Дата: {formatDate(request.paid_at)})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {request.work_type === 'INSTALLATION' && (
                    <div className="info-card">
                      <div className="info-card-title">Установка</div>
                      <div className="info-row"><span className="info-key">Блокировка</span><span className="info-val">{request.has_blocking ? 'С блокировкой' : 'Без блокировки'}</span></div>
                      <div className="info-row"><span className="info-key">Маяк</span><span className="info-val">{request.has_beacon ? 'С маяком' : 'Без маяка'}</span></div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'comments' && (
                <div className="tab-content flex-col">
                   <div className="comments-area">
                    {comments.length === 0 ? <div className="empty-state">Нет комментариев</div> : 
                      comments.map((c, i) => (
                        <div key={i} className="comment-bubble">
                          <strong>{c.author || 'Пользователь'}</strong> <span className="comment-date">{formatDate(c.created_at)}</span>
                          <p>{c.message}</p>
                        </div>
                      ))
                    }
                  </div>
                  <div className="comment-input-area">
                    <textarea placeholder="Написать комментарий..." value={newComment} onChange={(e) => setNewComment(e.target.value)}></textarea>
                    <button className="btn-green" onClick={handleAddComment}>Отправить</button>
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="tab-content">
                   {history.length === 0 ? <div className="empty-state">История пуста</div> : (
                    <div className="history-timeline">
                      {history.map((h, i) => (
                        <div key={i} className="history-item">
                          <div className="history-dot"></div>
                          <div className="history-content">
                            <div className="history-action">{renderHistoryMessage(h)}</div>
                            <div className="history-meta">{formatDate(h.created_at)} <span className="history-author">{h.user_name || 'Система'}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {request && (
          <div className="custom-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '15px' }}>
            
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                {userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN' ? (
                  <div className="footer-group">
                    <span style={{ fontSize: '13px' }}>Статус:</span>
                    <select className="footer-select" style={{ padding: '4px 8px', fontSize: '13px' }} value={request.status || 'NEW'} onChange={handleStatusChange}>
                      <option value="NEW">В ожидании</option>
                      <option value="IN_PROGRESS">В процессе установки</option>
                      <option value="COMPLETED">Работы завершены</option>
                      <option value="CANCELLED">Отмена заявки</option>
                    </select>
                  </div>
                ) : (
                  <div className="footer-group">
                    <span style={{ fontSize: '13px' }}>Статус: <strong>{request.status === 'NEW' ? 'В ожидании' : request.status === 'IN_PROGRESS' ? 'В процессе установки' : request.status === 'COMPLETED' ? 'Завершено' : 'Отменено'}</strong></span>
                  </div>
                )}

                {userRole === 'ADMIN' || userRole === 'ACCOUNTANT' ? (
                  <div className="footer-group">
                    <span style={{ fontSize: '13px' }}>Оплата:</span>
                    <select className="footer-select" style={{ padding: '4px 8px', fontSize: '13px' }} value={request.is_paid ? 'true' : 'false'} onChange={handlePaymentChange}>
                      <option value="false">Ожидает оплаты</option>
                      <option value="true">Оплачено</option>
                    </select>
                  </div>
                ) : (
                  <div className="footer-group">
                    <span style={{ fontSize: '13px' }}>Оплата: <strong>{request.is_paid ? 'Оплачено' : 'Ожидает оплаты'}</strong></span>
                  </div>
                )}
              </div>

              {/* КНОПКА УДАЛЕНИЯ ТОЛЬКО ДЛЯ АДМИНА */}
              {userRole === 'ADMIN' && (
                <button 
                  onClick={handleDeleteRequest}
                  style={{ background: 'transparent', border: '1px solid #ffcdd2', color: '#c62828', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
                >
                  🗑 Удалить заявку
                </button>
              )}

            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
              {(userRole === 'ADMIN' || userRole === 'SENIOR_TECHNICIAN') && request.status !== 'COMPLETED' && request.status !== 'CANCELLED' ? (
                <div className="footer-group">
                  <span style={{ fontSize: '13px' }}>Монтажник:</span>
                  <select 
                    className="footer-select" 
                    style={{ padding: '4px 8px', fontSize: '13px', maxWidth: '160px' }} 
                    value={selectedTech} 
                    onChange={(e) => setSelectedTech(e.target.value)}
                  >
                    <option value="">— не назначен —</option>
                    {technicians.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                <button 
                    className="btn-green" 
                    style={{ padding: '5px 12px', fontSize: '13px' }} 
                    onClick={handleAssign}
                  >
                    {request.assigned_to ? (selectedTech ? 'Изменить' : 'Снять') : 'Назначить'}
                  </button>
                </div>
              ) : request.assigned_to ? (
                <div className="footer-group">
                   <span style={{ color: '#5e9424', fontWeight: '500', fontSize: '13px' }}>
                     ✓ Назначен: {getTechName(request.assigned_to)}
                   </span>
                </div>
              ) : null}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}