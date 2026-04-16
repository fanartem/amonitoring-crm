import React, { useState, useEffect } from 'react';

export default function CreateRequestModal({ isOpen, onClose, onCreated }) {
  // Выбор типа клиента: новый или существующий
  const [clientKind, setClientKind] = useState('new');
  const [clientsList, setClientsList] = useState([]);

  // Огромный стейт для всех твоих полей в стиле snake_case (как любит Python)
  const [formData, setFormData] = useState({
    client_id: '',
    client_type: 'ТОО',
    client_name: '',
    phone: '',
    city: '',
    company_name: '',

    work_type: 'Установка',
    work_format: 'Выезд к клиенту',
    work_address: '',
    work_date: '',

    car_type: 'Легковое',
    car_model: '',
    car_vin: '',
    car_plate: '',
    car_year: '',

    blocking: 'С блокировкой',
    beacon: 'С маяком',
    sensors: '',

    monitoring_email: '',
    monitoring_password: '',
    manager_comment: ''
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Загружаем клиентов для выпадающего списка, когда модалка открывается
  useEffect(() => {
    if (isOpen) {
      fetchClients();
    }
  }, [isOpen]);

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/clients', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClientsList(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки клиентов:', err);
    }
  };

  if (!isOpen) return null;

  // Универсальный обработчик полей
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Обработчик выбора существующего клиента
  const handleExistingClientSelect = (e) => {
    const selectedId = e.target.value;
    const client = clientsList.find(c => c.id === Number(selectedId));
    
    if (client) {
      setFormData({
        ...formData,
        client_id: client.id,
        client_type: client.type || 'Физ. лицо',
        client_name: client.name || '',
        phone: client.phone || '',
        city: client.city || '',
        company_name: client.company_name || client.company || ''
      });
    } else {
      // Сброс, если выбрали "— выберите —"
      setFormData({ ...formData, client_id: '', client_name: '', phone: '', city: '', company_name: '' });
    }
  };

  // Сброс формы и закрытие
  const handleClose = () => {
    setClientKind('new');
    setError('');
    setFormData({
      client_id: '', client_type: 'ТОО', client_name: '', phone: '', city: '', company_name: '',
      work_type: 'Установка', work_format: 'Выезд к клиенту', work_address: '', work_date: '',
      car_type: 'Легковое', car_model: '', car_vin: '', car_plate: '', car_year: '',
      blocking: 'С блокировкой', beacon: 'С маяком', sensors: '',
      monitoring_email: '', monitoring_password: '', manager_comment: ''
    });
    onClose();
  };

  // Отправка формы (сначала Клиент, потом Авто, потом Заявка)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Проверяем обязательные поля
    if (!formData.client_name || !formData.phone || !formData.work_date || !formData.car_model || !formData.monitoring_email) {
      setError('Заполните обязательные поля (имя, телефон, дата, марка/модель, email)');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      let finalClientId = formData.client_id ? parseInt(formData.client_id, 10) : null;

      
     // === ШАГ 1: Создаем клиента (если выбран "Новый клиент") ===
      if (clientKind === 'new') {
        const clientTypeMap = { 'ТОО': 'TOO', 'ИП': 'IP', 'Физ. лицо': 'INDIVIDUAL' };

        const clientRes = await fetch('http://127.0.0.1:8000/clients', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: clientTypeMap[formData.client_type] || 'INDIVIDUAL',
            name: formData.client_name,
            company_name: formData.company_name || null,
            phone: formData.phone,
            email: null 
          })
        });
        
        if (!clientRes.ok) {
          const errText = await clientRes.text();
          throw new Error(`Ошибка бэкенда (Клиент): ${errText}`);
        }
        
        const clientData = await clientRes.json();
        
        // УМНЫЙ ПОИСК ID: ищем id, или client_id, или если сервер вернул просто число
        finalClientId = clientData.id || clientData.client_id || (typeof clientData === 'number' ? clientData : null);
        
        // Предохранитель: если всё равно не нашли ID, останавливаемся и смотрим, что прислал сервер
        if (!finalClientId || isNaN(finalClientId)) {
           throw new Error(`Сервер создал клиента, но не вернул понятный ID. Ответ сервера: ${JSON.stringify(clientData)}`);
        }
        
        finalClientId = parseInt(finalClientId, 10); 
        
      } else if (!finalClientId) {
        throw new Error('Выберите существующего клиента из списка');
      }

      // === ШАГ 2: Создаем автомобиль ===
      const brandStr = formData.car_model.split(' ')[0] || "Не указано";
      const modelStr = formData.car_model.substring(brandStr.length).trim() || formData.car_model;

      const vehicleRes = await fetch('http://127.0.0.1:8000/vehicles', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_id: finalClientId, // Теперь это 100% число!
          brand: brandStr,
          model: modelStr,
          plate_number: formData.car_plate || "Нет",
          vin: formData.car_vin || null,
          year: formData.car_year ? parseInt(formData.car_year, 10) : null,
          type: formData.car_type
        })
      });
      if (!vehicleRes.ok) {
        const errText = await vehicleRes.text();
        throw new Error(`Ошибка бэкенда (Авто): ${errText}`);
      }
      const vehicleData = await vehicleRes.json();
      const finalVehicleId = parseInt(vehicleData.id, 10);

      // === ШАГ 3: Создаем саму заявку ===
      const workTypeMap = { 'Установка': 'INSTALLATION', 'Диагностика': 'DIAGNOSTICS', 'Снятие': 'UNINSTALLATION' };
      const visitTypeMap = { 'Выезд к клиенту': 'FIELD', 'В офисе': 'SERVICE' };

      const requestRes = await fetch('http://127.0.0.1:8000/requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_id: finalClientId,
          vehicle_id: finalVehicleId,
          work_type: workTypeMap[formData.work_type] || 'INSTALLATION',
          visit_type: visitTypeMap[formData.work_format] || 'FIELD',
          installation: {
            has_beacon: formData.beacon === 'С маяком',
            has_blocking: formData.blocking === 'С блокировкой'
          }
        })
      });

      if (!requestRes.ok) {
        const errText = await requestRes.text();
        try {
          const errData = JSON.parse(errText);
          if (Array.isArray(errData.detail)) {
            const messages = errData.detail.map(err => `${err.loc[err.loc.length - 1]}: ${err.msg}`).join(' | ');
            throw new Error(`Ошибка данных: ${messages}`);
          }
          throw new Error(errData.detail || `Ошибка при создании заявки: ${errText}`);
        } catch (parseError) {
          throw new Error(`Ошибка сервера (Заявка): ${errText}`);
        }
      }

      // Если всё прошло успешно!
      onCreated(); 
      handleClose();   
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isExisting = clientKind === 'existing';

  return (
    <div className="modal-overlay open">
      <div className="modal-window">
        
        <div className="modal-header">
          <div className="modal-title">Создание заявки</div>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>
        
        {error && <div className="validation-banner visible">{error}</div>}
        
        <div className="modal-body" style={{ background: '#f7f7f7', padding: '20px' }}>
          <form id="request-form" onSubmit={handleSubmit}>
            
            {/* 1. Данные клиента */}
            <div className="form-section">
              <h3 className="form-section-title">1. Данные клиента</h3>
              <div className="form-row">
                <label className="radio-label req-mark">
                  <input type="radio" value="new" checked={clientKind === 'new'} onChange={() => setClientKind('new')} /> 
                  Новый клиент
                </label>
                <label className="radio-label">
                  <input type="radio" value="existing" checked={clientKind === 'existing'} onChange={() => setClientKind('existing')} /> 
                  Существующий клиент
                </label>
              </div>

              {isExisting && (
                <div className="form-row align-center">
                  <span className="field-label req-mark">Выберите клиента:</span>
                  <select className="form-input" style={{ width: '240px' }} onChange={handleExistingClientSelect} value={formData.client_id}>
                    <option value="">— выберите —</option>
                    {clientsList.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name || c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-row align-center">
                <span className="field-label req-mark">Тип клиента:</span>
                <label className="radio-label"><input type="radio" name="client_type" value="ТОО" checked={formData.client_type === 'ТОО'} onChange={handleChange} disabled={isExisting} /> ТОО</label>
                <label className="radio-label"><input type="radio" name="client_type" value="ИП" checked={formData.client_type === 'ИП'} onChange={handleChange} disabled={isExisting} /> ИП</label>
                <label className="radio-label"><input type="radio" name="client_type" value="Физ. лицо" checked={formData.client_type === 'Физ. лицо'} onChange={handleChange} disabled={isExisting} /> Физ. лицо</label>
              </div>

              <div className="form-row align-center">
                <span className="field-label req-mark">ФИО:</span>
                <input className="form-input" type="text" name="client_name" value={formData.client_name} onChange={handleChange} readOnly={isExisting} />
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Контактный номер:</span>
                <input className="form-input" type="tel" name="phone" value={formData.phone} onChange={handleChange} readOnly={isExisting} />
              </div>

              <div className="form-row align-center">
                <span className="field-label req-mark">Город:</span>
                <select className="form-input" name="city" value={formData.city} onChange={handleChange} disabled={isExisting}>
                  <option value="">— город —</option>
                  <option>Алматы</option><option>Астана</option><option>Шымкент</option>
                  <option>Караганда</option><option>Актобе</option><option>Тараз</option>
                  <option>Павлодар</option><option>Усть-Каменогорск</option><option>Семей</option>
                  <option>Костанай</option><option>Кызылорда</option><option>Уральск</option>
                </select>
              </div>
              <div className="form-row col">
                <span className="field-label">Название компании (если ТОО/ИП):</span>
                <textarea className="form-textarea" name="company_name" rows="2" value={formData.company_name} onChange={handleChange} readOnly={isExisting}></textarea>
              </div>
            </div>

            {/* 2. Организация работ */}
            <div className="form-section">
              <h3 className="form-section-title">2. Организация работ</h3>
              <div className="form-row align-center">
                <span className="field-label req-mark">Форма работы</span>
                <label className="radio-label"><input type="radio" name="work_type" value="Установка" checked={formData.work_type === 'Установка'} onChange={handleChange} /> Установка</label>
                <label className="radio-label"><input type="radio" name="work_type" value="Диагностика" checked={formData.work_type === 'Диагностика'} onChange={handleChange} /> Диагностика</label>
                <label className="radio-label"><input type="radio" name="work_type" value="Снятие" checked={formData.work_type === 'Снятие'} onChange={handleChange} /> Снятие</label>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Формат:</span>
                <label className="radio-label"><input type="radio" name="work_format" value="Выезд к клиенту" checked={formData.work_format === 'Выезд к клиенту'} onChange={handleChange} /> Выезд к клиенту</label>
                <label className="radio-label"><input type="radio" name="work_format" value="В офисе" checked={formData.work_format === 'В офисе'} onChange={handleChange} /> В офисе</label>
              </div>
              <div className="form-row col">
                <span className="field-label muted">Адрес:</span>
                <textarea className="form-textarea" name="work_address" rows="2" value={formData.work_address} onChange={handleChange}></textarea>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Дата выполнения:</span>
                <input className="form-input short" type="date" name="work_date" value={formData.work_date} onChange={handleChange} />
              </div>
            </div>

            {/* 3. Транспорт */}
            <div className="form-section">
              <h3 className="form-section-title">3. Данные транспорта</h3>
              <div className="form-row align-center">
                <span className="field-label">Тип авто:</span>
                <label className="radio-label"><input type="radio" name="car_type" value="Легковое" checked={formData.car_type === 'Легковое'} onChange={handleChange} /> Легковое</label>
                <label className="radio-label"><input type="radio" name="car_type" value="Грузовое" checked={formData.car_type === 'Грузовое'} onChange={handleChange} /> Грузовое</label>
                <label className="radio-label"><input type="radio" name="car_type" value="Спец. техника" checked={formData.car_type === 'Спец. техника'} onChange={handleChange} /> Спец. техника</label>
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">Марка и модель:</span>
                <input className="form-input" type="text" name="car_model" value={formData.car_model} onChange={handleChange} />
              </div>
              <div className="form-row align-center">
                <span className="field-label req-mark">VIN:</span>
                <input className="form-input" type="text" name="car_vin" value={formData.car_vin} onChange={handleChange} />
              </div>
              <div className="form-row align-center">
                <span className="field-label">Гос. номер:</span>
                <input className="form-input" type="text" name="car_plate" value={formData.car_plate} onChange={handleChange} />
              </div>
              <div className="form-row align-center">
                <span className="field-label">Год выпуска:</span>
                <input className="form-input short" type="number" name="car_year" min="1900" max="2099" value={formData.car_year} onChange={handleChange} />
              </div>
            </div>

            {/* 4. Установка */}
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
              <div className="form-row col">
                <span className="field-label muted">Доп. датчики</span>
                <textarea className="form-textarea" name="sensors" rows="2" value={formData.sensors} onChange={handleChange}></textarea>
              </div>
            </div>

            {/* 5. Доступ */}
            <div className="form-section">
              <h3 className="form-section-title">5. Доступ в систему мониторинга</h3>
              <div className="form-row col">
                <span className="field-label req-mark">Электронная почта</span>
                <input className="form-input full" type="email" name="monitoring_email" value={formData.monitoring_email} onChange={handleChange} />
              </div>
              <div className="form-row col">
                <span className="field-label muted">Предпочитаемый пароль</span>
                <input className="form-input full" type="text" name="monitoring_password" placeholder="Иначе будет сгенерирован" value={formData.monitoring_password} onChange={handleChange} />
              </div>
            </div>

            {/* 6. Комментарии (твоя фишка: разблокируется только для старых клиентов) */}
            <div className="form-section">
              <h3 className="form-section-title">6. Комментарии от менеджера</h3>
              {!isExisting && (
                <div className="comment-lock-notice visible">
                  💡 Комментарии доступны после создания клиента (выберите «Существующий клиент»)
                </div>
              )}
              <textarea 
                className="form-textarea full-width" 
                name="manager_comment" 
                rows="3" 
                placeholder="Пожелания клиента, особенности авто" 
                disabled={!isExisting}
                value={formData.manager_comment} 
                onChange={handleChange}
              ></textarea>
            </div>

          </form>
        </div>
        
        <div className="modal-footer">
          <button className="modal-submit-btn" type="button" onClick={handleClose} style={{ borderColor: '#aaa', color: '#888' }}>Отмена</button>
          <button className="modal-submit-btn" type="submit" form="request-form" disabled={loading}>
            {loading ? 'Создание...' : 'Создать заявку'}
          </button>
        </div>

      </div>
    </div>
  );
}