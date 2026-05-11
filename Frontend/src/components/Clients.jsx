import React, { useState, useEffect } from 'react';
import '../styles/Clients.css'; 
import '../styles/Requests.css';
import CreateClientModal from './CreateClientModal';
import RequestDetailModal from './RequestDetailModal';

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

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [selectedClient, setSelectedClient] = useState(null); 
  const [clientRequests, setClientRequests] = useState([]);
  const [clientVehicles, setClientVehicles] = useState([]); 
  const [isVehiclesLoading, setIsVehiclesLoading] = useState(false);
  const [technicians, setTechnicians] = useState([]); 

  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  // НОВОЕ: Состояние для редактируемого клиента
  const [editClientData, setEditClientData] = useState(null); 
  
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState(null);
  
  const userRole = getUserRole();

  useEffect(() => {
    fetchClients();
    fetchTechnicians(); 
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const fetchClients = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('http://127.0.0.1:8000/clients', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить список клиентов');
      }

      const data = await response.json();
      setClients(data.filter(c => !c.is_deleted));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTechnicians = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/users/technicians', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTechnicians(await res.json());
    } catch (err) { console.error(err); }
  };

  const getTechName = (techId) => {
    if (!techId) return null;
    const tech = technicians.find(t => t.id === techId);
    return tech ? tech.name : `ID: ${techId}`;
  };

  const handleClientClick = async (client) => {
    setSelectedClient(client);
    setClientVehicles([]); 
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/clients/${client.id}/requests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClientRequests(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки заявок клиента:', err);
    }
  };

  const fetchClientVehicles = async (clientId) => {
    setIsVehiclesLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/vehicles?client_id=${clientId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClientVehicles(data);
        if (data.length === 0) alert('У этого клиента пока нет добавленных автомобилей.');
      }
    } catch (err) {
      console.error('Ошибка загрузки машин:', err);
    } finally {
      setIsVehiclesLoading(false);
    }
  };

  const handleDeleteClient = async (e, clientId, clientName) => {
    e.stopPropagation();
    setActiveDropdown(null);
    if (!window.confirm(`Вы уверены, что хотите удалить клиента "${clientName}"?`)) return;

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        alert('Клиент успешно удален в корзину!');
        fetchClients(); 
        if (selectedClient && selectedClient.id === clientId) {
          setSelectedClient(null); // Если удалили открытого клиента, закрываем его карточку
        }
      } else {
        const errData = await res.text();
        throw new Error(errData);
      }
    } catch (err) {
      alert(`Ошибка при удалении: ${err.message}`);
    }
  };

  // НОВОЕ: Обработчик клика "Редактировать"
  const handleEditClientClick = (e, client) => {
    e.stopPropagation();
    setActiveDropdown(null);
    setEditClientData(client);
    setCreateModalOpen(true);
  };

  const toggleDropdown = (e, clientId) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === clientId ? null : clientId);
  };

  const statusLabels = { 'NEW': 'В ожидании', 'IN_PROGRESS': 'В процессе установки', 'COMPLETED': 'Работы завершены', 'CANCELLED': 'Отменено' };
  
  const statusClasses = { 
    'NEW': 'status-new', 
    'IN_PROGRESS': 'status-progress', 
    'COMPLETED': 'status-done', 
    'CANCELLED': 'status-cancelled' 
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
  };

  const getPillStyle = (color) => ({
    fontSize: '11px', color: '#fff', padding: '2px 10px',
    borderRadius: '12px', background: color, fontWeight: 'bold', display: 'inline-block'
  });

  return (
    <div className="clients-page-container">
      
      {!selectedClient ? (
        <>
          <div className="clients-header-bar">
            <h2>Клиенты</h2>
            <div className="clients-header-actions">
              <span className="subtitle-text">Клиенты из заявок и созданные вручную</span>
              {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
                <button className="btn-green" onClick={() => { setEditClientData(null); setCreateModalOpen(true); }}>+ Добавить клиента</button>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Загрузка клиентов...</div>
          ) : error ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#c53030' }}>{error}</div>
          ) : clients.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Нет клиентов</div>
          ) : (
            <div className="clients-grid">
              {clients.map(client => (
                <div key={client.id} className="client-card" style={{ cursor: 'default', position: 'relative', zIndex: activeDropdown === client.id ? 100 : 1 }}>
                  <div className="client-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ paddingRight: '10px' }}>{client.company_name || client.name}</span>
                    
                    {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
                      <div className="card-actions-wrapper" style={{ position: 'relative', marginTop: '-2px', marginRight: '-5px' }}>
                        <div className="card-actions" style={{ cursor: 'pointer', padding: '0 5px', fontSize: '20px', color: '#888', lineHeight: '1' }} onClick={(e) => toggleDropdown(e, client.id)}>&#8942;</div>
                        
                        {activeDropdown === client.id && (
                          <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: '25px', background: '#fff', border: '1px solid #eee', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '5px 0', minWidth: '150px', zIndex: 100 }}>
                            <div className="dropdown-item" style={{ padding: '8px 15px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f5f5f5', color: '#333' }} onClick={(e) => handleEditClientClick(e, client)}>
                              ✎ Редактировать
                            </div>
                            <div className="dropdown-item" style={{ padding: '8px 15px', cursor: 'pointer', fontSize: '14px', color: '#c62828' }} onClick={(e) => handleDeleteClient(e, client.id, client.company_name || client.name)}>
                              🗑 Удалить
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="client-card-type">{client.type} {client.company_name ? ` · ${client.name}` : ''}</div>
                  <div className="client-card-info">{client.phone} {client.email ? ` · ${client.email}` : ''}</div>
                  
                  <div className="client-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                    <div>
                      <span className="request-count-label">Заявок:</span>
                      <span className={`request-count-badge ${client.request_count > 0 ? 'active' : ''}`} style={{ marginLeft: '8px' }}>{client.request_count || 0}</span>
                    </div>
                    <button className="btn-details" onClick={(e) => { e.stopPropagation(); handleClientClick(client); }}>Детали</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="client-detail-view">
          <div className="clients-header-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <button className="btn-back" onClick={() => setSelectedClient(null)}>&larr; Назад</button>
              <h2>{selectedClient.company_name || selectedClient.name}</h2>
            </div>
          </div>

          <div className="client-info-box" style={{ position: 'relative' }}>
            
            {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
              <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '10px' }}>
                <button className="btn-edit-request" onClick={(e) => handleEditClientClick(e, selectedClient)}>
                  ✎ Редактировать
                </button>
              </div>
            )}

            <div className="info-row"><span className="info-key">ФИО / Название</span><span className="info-val">{selectedClient.company_name || selectedClient.name}</span></div>
            <div className="info-row"><span className="info-key">Тип лица</span><span className="info-val">{selectedClient.type}</span></div>
            <div className="info-row"><span className="info-key">Телефон</span><span className="info-val">{selectedClient.phone}</span></div>
            <div className="info-row"><span className="info-key">Email</span><span className="info-val">{selectedClient.email || '—'}</span></div>
            
            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #eee' }}>
              <button className="btn-green" onClick={() => fetchClientVehicles(selectedClient.id)} disabled={isVehiclesLoading} style={{ padding: '6px 12px', fontSize: '13px' }}>
                {isVehiclesLoading ? 'Загрузка...' : '🚗 Просмотреть все машины клиента'}
              </button>

              {clientVehicles.length > 0 && (
                <div style={{ marginTop: '15px', background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Транспорт клиента ({clientVehicles.length}):</h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#555' }}>
                    {clientVehicles.map(v => (
                      <li key={v.id} style={{ marginBottom: '8px' }}>
                        <strong>{v.brand} {v.model}</strong> 
                        <span style={{ color: '#888' }}> — Гос. номер: {v.plate_number || 'б/н'}, VIN: {v.vin || '—'}, Год: {v.year || '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

          </div>

          <h3 className="section-title" style={{ marginTop: '30px' }}>Заявки клиента ({clientRequests.length})</h3>
          
          <div className="requests-list" style={{ marginTop: '15px' }}>
            {clientRequests.length === 0 ? <div style={{ textAlign: 'center', color: '#888', marginTop: '20px' }}>Нет заявок</div> : null}
            
            {clientRequests.map(req => (
              <div key={req.id} className="request-card" style={{ position: 'relative', cursor: 'default' }}>
                <div className="card-column">
                  <div className="card-item"><span className="card-label">Клиент</span><span className="card-value">{req.client_name || selectedClient.name}</span></div>
                  <div className="card-item"><span className="card-label">Статус</span><div className={`status-badge ${statusClasses[req.status] || 'status-new'}`}>{statusLabels[req.status] || req.status}</div></div>
                  {req.assigned_to && (
                    <div className="card-item" style={{ marginTop: '5px' }}>
                      <span className="card-label">Исполнитель</span>
                      <span className="card-value" style={{ fontWeight: '600', color: '#5e9424', fontSize: '13px' }}>{getTechName(req.assigned_to)}</span>
                    </div>
                  )}
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
                      {req.is_paid && req.paid_at && (
                        <span style={{ fontSize: '11px', color: '#888', fontWeight: '500' }}>
                          {formatDate(req.paid_at).split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card-actions-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'absolute', top: '15px', right: '15px' }}>
                  <button className="btn-details" onClick={(e) => { e.stopPropagation(); setSelectedRequestId(req.id); }}>Детали</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateClientModal 
        isOpen={isCreateModalOpen} 
        editClientData={editClientData}
        onClose={() => { setCreateModalOpen(false); setEditClientData(null); }} 
        onCreated={() => { 
          setCreateModalOpen(false); 
          setEditClientData(null);
          fetchClients(); 
          if (selectedClient) handleClientClick(selectedClient);
        }} 
      />

      <RequestDetailModal 
        isOpen={!!selectedRequestId} 
        requestId={selectedRequestId} 
        onClose={() => setSelectedRequestId(null)} 
        onUpdated={() => {
          if (selectedClient) handleClientClick(selectedClient);
        }} 
      />
    </div>
  );
}