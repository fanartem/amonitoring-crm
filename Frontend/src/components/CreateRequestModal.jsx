import React, { useState, useEffect } from 'react';

// Умные мапперы (теперь понимают любой регистр)
const mapTypeToUI = (dbType) => {
  if (!dbType) return 'Физ. лицо';
  const t = String(dbType).toUpperCase();
  if (t === 'TOO' || t === 'ТОО') return 'ТОО';
  if (t === 'IP' || t === 'ИП') return 'ИП';
  return 'Физ. лицо';
};

const mapTypeToDB = (uiType) => {
  if (uiType === 'ТОО') return 'TOO';
  if (uiType === 'ИП') return 'IP';
  return 'INDIVIDUAL';
};

export default function CreateRequestModal({ isOpen, onClose, onCreated, editRequestData }) {
  const [clientKind, setClientKind] = useState('new');
  const [clientsList, setClientsList] = useState([]);
  const [clientVehicles, setClientVehicles] = useState([]); 

  const isEditMode = !!editRequestData; 

  const [formData, setFormData] = useState({
    client_id: '', 
    client_type: 'Физ. лицо', 
    client_name: '', 
    phone: '', 
    city: '', 
    company_name: '',
    work_type: 'Установка', 
    work_format: 'Выезд к клиенту', 
    work_address: '', 
    work_date: '',
    car_id: '',
    car_type: 'Легковая', 
    car_brand: '', 
    car_model: '', 
    car_vin: '', 
    car_plate: '', 
    car_year: '',
    blocking: 'С блокировкой', 
    beacon: 'С маяком', 
    manager_comment: ''
  });

  const [error, setError] = useState('');
  const [missingFields, setMissingFields] = useState([]); 
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchClients();
      if (isEditMode && editRequestData) {
        setClientKind('existing');
        setFormData(prev => ({
          ...prev,
          client_id: editRequestData.client_id || '',
          car_id: editRequestData.vehicle_id || '', // Добавили car_id для сохранения
          client_type: mapTypeToUI(editRequestData.client_type || editRequestData.type),
          client_name: editRequestData.client_name || '',
          company_name: editRequestData.company_name || '',
          phone: editRequestData.phone || '',
          city: editRequestData.city || '',
          work_type: editRequestData.work_type === 'INSTALLATION' ? 'Установка' : editRequestData.work_type === 'REMOVAL' ? 'Снятие' : 'Диагностика',
          work_format: editRequestData.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе',
          work_address: editRequestData.address || '',
          car_brand: editRequestData.brand || '',
          car_model: editRequestData.model || '',
          car_plate: editRequestData.plate_number || '',
          car_vin: editRequestData.vin || '',
          car_year: editRequestData.year || '',
          beacon: editRequestData.has_beacon ? 'С маяком' : 'Без маяка',
          blocking: editRequestData.has_blocking ? 'С блокировкой' : 'Без блокировки',
        }));
      }
    }
  }, [isOpen, editRequestData, isEditMode]);

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/clients', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setClientsList(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchClientVehicles = async (clientId) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/vehicles?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setClientVehicles(Array.isArray(data) ? data : []);
      }
    } catch (err) { console.error(err); }
  };

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (missingFields.includes(name)) {
      setMissingFields(missingFields.filter(f => f !== name));
    }
  };

  const handleExistingClientSelect = (e) => {
    const selectedId = e.target.value;
    const client = clientsList.find(c => c.id === Number(selectedId));
    if (client) {
      setFormData({ 
        ...formData, 
        client_id: client.id, 
        client_type: mapTypeToUI(client.type || client.client_type), 
        client_name: client.name || '', 
        phone: client.phone || '', 
        company_name: client.company_name || '',
        car_id: '', car_brand: '', car_model: '', car_plate: '', car_vin: '', car_year: '', car_type: 'Легковая'
      });
      fetchClientVehicles(client.id);
      setMissingFields(missingFields.filter(f => !['client_name', 'phone'].includes(f)));
    } else {
      setFormData({ ...formData, client_id: '', client_type: 'Физ. лицо', client_name: '', phone: '', company_name: '' });
      setClientVehicles([]);
    }
  };

  const handleExistingVehicleSelect = (e) => {
    const selectedId = e.target.value;
    if (!selectedId) {
      setFormData({ ...formData, car_id: '', car_brand: '', car_model: '', car_plate: '', car_vin: '', car_year: '', car_type: 'Легковая' });
      return;
    }
    const vehicle = clientVehicles.find(v => v.id === Number(selectedId));
    if (vehicle) {
      setFormData({ 
        ...formData, 
        car_id: vehicle.id,
        car_type: vehicle.type || 'Легковая',
        car_brand: vehicle.brand || '',
        car_model: vehicle.model || '',
        car_plate: vehicle.plate_number || '',
        car_vin: vehicle.vin || '',
        car_year: vehicle.year || ''
      });
      setMissingFields(missingFields.filter(f => !['car_brand', 'car_model'].includes(f)));
    }
  };

  const handleClose = () => {
    setClientKind('new'); setError(''); setMissingFields([]); setClientVehicles([]);
    setFormData({
      client_id: '', client_type: 'Физ. лицо', client_name: '', phone: '', city: '', company_name: '',
      work_type: 'Установка', work_format: 'Выезд к клиенту', work_address: '', work_date: '',
      car_id: '', car_type: 'Легковая', car_brand: '', car_model: '', car_vin: '', car_plate: '', car_year: '',
      blocking: 'С блокировкой', beacon: 'С маяком', manager_comment: ''
    });
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    const required = [];
    if (!formData.client_name) required.push('client_name');
    if (!formData.phone) required.push('phone');
    if (!formData.city) required.push('city');
    
    if (clientKind === 'new' && (formData.client_type === 'ТОО' || formData.client_type === 'ИП') && !formData.company_name) {
      required.push('company_name');
    }

    if (!isEditMode) {
      if (!formData.work_date) required.push('work_date');
      if (!formData.car_brand) required.push('car_brand');
      if (!formData.car_model) required.push('car_model');
      if (formData.work_format === 'Выезд к клиенту' && !formData.work_address) {
        required.push('work_address');
      }
    }

    if (required.length > 0) {
      setMissingFields(required);
      setError('Пожалуйста, заполните все обязательные поля.');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

      // Умное формирование данных для отправки (чтобы бэк не путался)
      const basePayload = {
        city: formData.city,
        address: formData.work_format === 'Выезд к клиенту' ? formData.work_address : null,
        work_type: formData.work_type === 'Установка' ? 'INSTALLATION' : formData.work_type === 'Снятие' ? 'REMOVAL' : 'DIAGNOSTIC',
        visit_type: formData.work_format === 'Выезд к клиенту' ? 'ON_SITE' : 'IN_OFFICE',
      };

      // Отправляем детали установки ТОЛЬКО если это реально Установка
      if (formData.work_type === 'Установка') {
        basePayload.installation = { 
          has_beacon: formData.beacon === 'С маяком', 
          has_blocking: formData.blocking === 'С блокировкой' 
        };
      } else {
        basePayload.installation = null; 
      }

      // ЛОГИКА РЕДАКТИРОВАНИЯ (PATCH)
      if (isEditMode) {
        const updateRes = await fetch(`http://127.0.0.1:8000/requests/${editRequestData.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify(basePayload)
        });
        if (!updateRes.ok) throw new Error(`Ошибка редактирования заявки: ${await updateRes.text()}`);

        if (formData.client_id) {
          await fetch(`http://127.0.0.1:8000/clients/${formData.client_id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              name: formData.client_name,
              phone: formData.phone,
              company_name: formData.client_type !== 'Физ. лицо' ? formData.company_name : null
            })
          }).catch(e => console.error('Ошибка фонового обновления клиента:', e));
        }

        if (formData.car_id) {
          await fetch(`http://127.0.0.1:8000/vehicles/${formData.car_id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              brand: formData.car_brand,
              model: formData.car_model,
              plate_number: formData.car_plate,
              vin: formData.car_vin,
              year: formData.car_year ? parseInt(formData.car_year, 10) : null
            })
          }).catch(e => console.error('Ошибка фонового обновления авто:', e));
        }

        onCreated(); handleClose();
        return;
      }

      // ЛОГИКА СОЗДАНИЯ
      let finalClientId = formData.client_id ? parseInt(formData.client_id, 10) : null;
      if (clientKind === 'new') {
        const clientRes = await fetch('http://127.0.0.1:8000/clients', {
          method: 'POST', headers, body: JSON.stringify({ 
            type: mapTypeToDB(formData.client_type), name: formData.client_name, 
            company_name: (formData.client_type === 'Физ. лицо') ? null : formData.company_name, phone: formData.phone
          })
        });
        if (!clientRes.ok) throw new Error(`Ошибка Клиента: ${await clientRes.text()}`);
        const clientData = await clientRes.json();
        finalClientId = parseInt(clientData.id || clientData.client_id, 10);
      }

      let finalVehicleId = formData.car_id ? parseInt(formData.car_id, 10) : null;
      if (!finalVehicleId) {
        const vehicleRes = await fetch('http://127.0.0.1:8000/vehicles', {
          method: 'POST', headers, body: JSON.stringify({
            client_id: finalClientId, type: formData.car_type, brand: formData.car_brand, 
            model: formData.car_model, plate_number: formData.car_plate || "Нет", 
            vin: formData.car_vin || null, year: formData.car_year ? parseInt(formData.car_year, 10) : null
          })
        });
        if (!vehicleRes.ok) throw new Error(`Ошибка Автомобиля: ${await vehicleRes.text()}`);
        const vehicleData = await vehicleRes.json();
        finalVehicleId = parseInt(vehicleData.id || vehicleData.vehicle_id, 10);
      }

      const requestRes = await fetch('http://127.0.0.1:8000/requests', {
        method: 'POST', headers, 
        body: JSON.stringify({
          client_id: finalClientId, vehicle_id: finalVehicleId, ...basePayload
        })
      });
      if (!requestRes.ok) throw new Error(`Ошибка Заявки: ${await requestRes.text()}`);
      const requestData = await requestRes.json();

      if (formData.manager_comment) {
        await fetch('http://127.0.0.1:8000/requests/comments', {
          method: 'POST', headers, body: JSON.stringify({ request_id: requestData.request_id, message: formData.manager_comment })
        }).catch(e => console.error(e));
      }

      onCreated(); handleClose();   
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const isExisting = clientKind === 'existing';

  const getErrorStyle = (fieldName) => {
    return missingFields.includes(fieldName) ? { borderColor: '#c62828', backgroundColor: '#ffebee' } : {};
  };

  return (
    <div className="modal-overlay open">
      <div className="modal-window">
        <div className="modal-header">
          <div className="modal-title">{isEditMode ? 'Редактирование заявки' : 'Создание заявки'}</div>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>
        
        {error && <div className="validation-banner visible" style={{ background: '#ffebee', color: '#c62828', padding: '15px', borderBottom: '1px solid #ef9a9a', whiteSpace: 'pre-wrap' }}>{error}</div>}
        
        <div className="modal-body" style={{ background: '#f7f7f7', padding: '20px' }}>
          <form id="request-form" onSubmit={handleSubmit}>
            
            {/* 1. Данные клиента */}
            <div className="form-section">
              <h3 className="form-section-title">1. Данные клиента</h3>
              {!isEditMode && (
                <div className="form-row">
                  <label className="radio-label req-mark"><input type="radio" value="new" checked={clientKind === 'new'} onChange={() => setClientKind('new')} /> Новый клиент</label>
                  <label className="radio-label"><input type="radio" value="existing" checked={clientKind === 'existing'} onChange={() => setClientKind('existing')} /> Существующий клиент</label>
                </div>
              )}

              {isExisting && !isEditMode && (
                <div className="form-row align-center">
                  <span className="field-label req-mark">Выберите клиента:</span>
                  <select className="form-input" style={{ width: '240px' }} onChange={handleExistingClientSelect} value={formData.client_id}>
                    <option value="">— выберите —</option>
                    {clientsList.map(c => <option key={c.id} value={c.id}>{c.company_name || c.name}</option>)}
                  </select>
                </div>
              )}

              <div className="form-row align-center">
                <span className="field-label req-mark">Тип лица:</span>
                <select 
                  className="form-input" 
                  name="client_type" 
                  value={formData.client_type} 
                  onChange={handleChange} 
                  disabled={isExisting && !isEditMode}
                >
                  <option>Физ. лицо</option>
                  <option>ИП</option>
                  <option>ТОО</option>
                </select>
              </div>

              {(formData.client_type === 'ТОО' || formData.client_type === 'ИП') && (
                <div className="form-row align-center">
                  <span className="field-label req-mark">Наименование:</span>
                  <input className="form-input" style={getErrorStyle('company_name')} type="text" name="company_name" value={formData.company_name} onChange={handleChange} readOnly={isExisting && !isEditMode} />
                </div>
              )}

              <div className="form-row align-center">
                <span className="field-label req-mark">ФИО:</span>
                <input className="form-input" style={getErrorStyle('client_name')} type="text" name="client_name" value={formData.client_name} onChange={handleChange} readOnly={isExisting && !isEditMode} />
              </div>
              
              <div className="form-row align-center">
                <span className="field-label req-mark">Контактный номер:</span>
                <input className="form-input" style={getErrorStyle('phone')} type="tel" name="phone" value={formData.phone} onChange={handleChange} readOnly={isExisting && !isEditMode} />
              </div>
            </div>

            {/* 2. Организация работ */}
            <div className="form-section">
              <h3 className="form-section-title">2. Организация работ</h3>
              <div className="form-row align-center">
                <span className="field-label req-mark">Город:</span>
                <select className="form-input" style={getErrorStyle('city')} name="city" value={formData.city} onChange={handleChange}>
                  <option value="">— выберите город —</option>
                  <option>Алматы</option>
                  <option>Астана</option>
                  <option>Шымкент</option>
                  <option>Караганда</option>
                </select>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Форма работы</span>
                <label className="radio-label"><input type="radio" name="work_type" value="Установка" checked={formData.work_type === 'Установка'} onChange={handleChange} /> Установка</label>
                <label className="radio-label"><input type="radio" name="work_type" value="Снятие" checked={formData.work_type === 'Снятие'} onChange={handleChange} /> Снятие</label>
                <label className="radio-label"><input type="radio" name="work_type" value="Диагностика" checked={formData.work_type === 'Диагностика'} onChange={handleChange} /> Диагностика</label>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Формат:</span>
                <label className="radio-label"><input type="radio" name="work_format" value="Выезд к клиенту" checked={formData.work_format === 'Выезд к клиенту'} onChange={handleChange} /> Выезд к клиенту</label>
                <label className="radio-label"><input type="radio" name="work_format" value="В офисе" checked={formData.work_format === 'В офисе'} onChange={handleChange} /> В офисе</label>
              </div>
              {formData.work_format === 'Выезд к клиенту' && (
                <div className="form-row align-center">
                  <span className="field-label req-mark">Адрес выезда:</span>
                  <input className="form-input" style={{ width: '100%', ...getErrorStyle('work_address') }} type="text" name="work_address" value={formData.work_address} onChange={handleChange} placeholder="Укажите точный адрес..." />
                </div>
              )}
              {!isEditMode && (
                <div className="form-row align-center">
                  <span className="field-label req-mark">Дата выполнения:</span>
                  <input className="form-input short" style={getErrorStyle('work_date')} type="date" name="work_date" value={formData.work_date} onChange={handleChange} />
                </div>
              )}
            </div>

            {/* 3. Транспорт */}
            <div className="form-section">
              <h3 className="form-section-title">3. Данные транспорта</h3>
              
              {isExisting && clientVehicles.length > 0 && !isEditMode && (
                <div className="form-row align-center" style={{ marginBottom: '15px', background: '#f1f8e9', padding: '10px', borderRadius: '6px', border: '1px solid #c8e6c9' }}>
                  <span className="field-label" style={{ color: '#2e7d32', fontWeight: 'bold' }}>Выберите авто:</span>
                  <select className="form-input" style={{ borderColor: '#8bc34a' }} onChange={handleExistingVehicleSelect} value={formData.car_id}>
                    <option value="">— Новая машина —</option>
                    {clientVehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.brand} {v.model} ({v.plate_number || 'б/н'})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-row align-center">
                <span className="field-label req-mark">Тип техники:</span>
                <select className="form-input" name="car_type" value={formData.car_type} onChange={handleChange} disabled={!isEditMode && formData.car_id !== ''}>
                  <option>Легковая</option>
                  <option>Спецтехника</option>
                </select>
              </div>

              <div className="form-row align-center">
                <span className="field-label req-mark">Марка:</span>
                <input className="form-input" style={getErrorStyle('car_brand')} type="text" name="car_brand" value={formData.car_brand} onChange={handleChange} readOnly={!isEditMode && formData.car_id !== ''}/>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Модель:</span>
                <input className="form-input" style={getErrorStyle('car_model')} type="text" name="car_model" value={formData.car_model} onChange={handleChange} readOnly={!isEditMode && formData.car_id !== ''}/>
              </div>
              <div className="form-row align-center">
                <span className="field-label">Год выпуска:</span>
                <input className="form-input" type="number" name="car_year" value={formData.car_year} onChange={handleChange} readOnly={!isEditMode && formData.car_id !== ''} placeholder="Например: 2020"/>
              </div>
              <div className="form-row align-center">
                <span className="field-label">VIN-код:</span>
                <input className="form-input" type="text" name="car_vin" value={formData.car_vin} onChange={handleChange} readOnly={!isEditMode && formData.car_id !== ''} placeholder="17 символов" maxLength="17"/>
              </div>
              <div className="form-row align-center">
                <span className="field-label">Гос. номер:</span>
                <input className="form-input" type="text" name="car_plate" value={formData.car_plate} onChange={handleChange} readOnly={!isEditMode && formData.car_id !== ''}/>
              </div>
            </div>

            {formData.work_type === 'Установка' && (
              <div className="form-section">
                <h3 className="form-section-title">4. Параметры установки</h3>
                <div className="form-row align-center">
                  <label className="radio-label"><input type="radio" name="blocking" value="С блокировкой" checked={formData.blocking === 'С блокировкой'} onChange={handleChange} /> С блокировкой</label>
                  <label className="radio-label"><input type="radio" name="blocking" value="Без блокировки" checked={formData.blocking === 'Без блокировки'} onChange={handleChange} /> Без блокировки</label>
                </div>
                <div className="form-row align-center">
                  <label className="radio-label"><input type="radio" name="beacon" value="С маяком" checked={formData.beacon === 'С маяком'} onChange={handleChange} /> С маяком</label>
                  <label className="radio-label"><input type="radio" name="beacon" value="Без маяка" checked={formData.beacon === 'Без маяка'} onChange={handleChange} /> Без маяка</label>
                </div>
              </div>
            )}

            {!isEditMode && (
              <div className="form-section">
                <h3 className="form-section-title">{formData.work_type === 'Установка' ? '5.' : '4.'} Комментарии от менеджера</h3>
                <textarea 
                  className="form-textarea full-width" 
                  name="manager_comment" rows="3" placeholder="Оставьте комментарий к заявке..." 
                  value={formData.manager_comment} onChange={handleChange}
                ></textarea>
              </div>
            )}

          </form>
        </div>
        
        <div className="modal-footer">
          <button className="modal-submit-btn" type="button" onClick={handleClose} style={{ borderColor: '#aaa', color: '#888' }}>Отмена</button>
          <button className="modal-submit-btn" type="submit" form="request-form" disabled={loading}>
            {loading ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Создать заявку'}
          </button>
        </div>

      </div>
    </div>
  );
}