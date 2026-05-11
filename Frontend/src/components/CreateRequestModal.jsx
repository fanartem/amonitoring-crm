import React, { useState, useEffect } from 'react'
import '../styles/CreateRequestModal.css'

const mapTypeToUI = dbType => {
	if (!dbType) return 'Физ. лицо'

	const t = String(dbType).toUpperCase()

	if (t === 'TOO' || t === 'ТОО') return 'ТОО'
	if (t === 'IP' || t === 'ИП') return 'ИП'

	return 'Физ. лицо'
}

const mapTypeToDB = uiType => {
	if (uiType === 'ТОО') return 'TOO'
	if (uiType === 'ИП') return 'IP'

	return 'INDIVIDUAL'
}

export default function CreateRequestModal({
	isOpen,
	onClose,
	onCreated,
	editRequestData,
}) {
	const isEditMode = !!editRequestData

	const [clientKind, setClientKind] = useState('new')
	const [clientsList, setClientsList] = useState([])
	const [clientVehicles, setClientVehicles] = useState([])

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
		manager_comment: '',
	})

	const [error, setError] = useState('')
	const [missingFields, setMissingFields] = useState([])
	const [loading, setLoading] = useState(false)

	const emptyForm = {
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
		manager_comment: '',
	}

	useEffect(() => {
		if (!isOpen) return

		fetchClients()
		setError('')
		setMissingFields([])

		if (isEditMode && editRequestData) {
			setClientKind('existing')

			setFormData({
				client_id: editRequestData.client_id || '',
				client_type: mapTypeToUI(
					editRequestData.client_type || editRequestData.type,
				),
				client_name: editRequestData.client_name || '',
				phone: editRequestData.phone || '',
				city: editRequestData.city || '',
				company_name: editRequestData.company_name || '',

				work_type:
					editRequestData.work_type === 'INSTALLATION'
						? 'Установка'
						: editRequestData.work_type === 'REMOVAL'
							? 'Снятие'
							: 'Диагностика',

				work_format:
					editRequestData.visit_type === 'ON_SITE'
						? 'Выезд к клиенту'
						: 'В офисе',

				work_address: editRequestData.address || '',
				work_date: '',

				car_id: editRequestData.vehicle_id || '',
				car_type:
					editRequestData.vehicle_type ||
					editRequestData.car_type ||
					'Легковая',
				car_brand: editRequestData.brand || '',
				car_model: editRequestData.model || '',
				car_vin: editRequestData.vin || '',
				car_plate: editRequestData.plate_number || '',
				car_year: editRequestData.year || '',

				blocking: editRequestData.has_blocking
					? 'С блокировкой'
					: 'Без блокировки',
				beacon: editRequestData.has_beacon ? 'С маяком' : 'Без маяка',
				manager_comment: '',
			})
		} else {
			setClientKind('new')
			setClientVehicles([])
			setFormData(emptyForm)
		}
	}, [isOpen, editRequestData, isEditMode])

	const fetchClients = async () => {
		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch('http://127.0.0.1:8000/clients', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (res.ok) {
				setClientsList(await res.json())
			}
		} catch (err) {
			console.error(err)
		}
	}

	const fetchClientVehicles = async clientId => {
		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(
				`http://127.0.0.1:8000/vehicles?client_id=${clientId}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			)

			if (res.ok) {
				const data = await res.json()
				setClientVehicles(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error(err)
		}
	}

	if (!isOpen) return null

	const clearMissingField = fieldName => {
		if (missingFields.includes(fieldName)) {
			setMissingFields(prev => prev.filter(f => f !== fieldName))
		}
	}

	const handleChange = e => {
		const { name, value } = e.target

		setFormData(prev => ({
			...prev,
			[name]: value,
		}))

		clearMissingField(name)
	}

	const handleExistingClientSelect = e => {
		const selectedId = e.target.value
		const client = clientsList.find(c => c.id === Number(selectedId))

		if (client) {
			setFormData(prev => ({
				...prev,
				client_id: client.id,
				client_type: mapTypeToUI(client.type || client.client_type),
				client_name: client.name || '',
				phone: client.phone || '',
				company_name: client.company_name || '',

				car_id: '',
				car_brand: '',
				car_model: '',
				car_plate: '',
				car_vin: '',
				car_year: '',
				car_type: 'Легковая',
			}))

			fetchClientVehicles(client.id)

			setMissingFields(prev =>
				prev.filter(f => !['client_name', 'phone'].includes(f)),
			)
		} else {
			setFormData(prev => ({
				...prev,
				client_id: '',
				client_type: 'Физ. лицо',
				client_name: '',
				phone: '',
				company_name: '',
			}))

			setClientVehicles([])
		}
	}

	const handleExistingVehicleSelect = e => {
		const selectedId = e.target.value

		if (!selectedId) {
			setFormData(prev => ({
				...prev,
				car_id: '',
				car_brand: '',
				car_model: '',
				car_plate: '',
				car_vin: '',
				car_year: '',
				car_type: 'Легковая',
			}))

			return
		}

		const vehicle = clientVehicles.find(v => v.id === Number(selectedId))

		if (vehicle) {
			setFormData(prev => ({
				...prev,
				car_id: vehicle.id,
				car_type: vehicle.type || 'Легковая',
				car_brand: vehicle.brand || '',
				car_model: vehicle.model || '',
				car_plate: vehicle.plate_number || '',
				car_vin: vehicle.vin || '',
				car_year: vehicle.year || '',
			}))

			setMissingFields(prev =>
				prev.filter(f => !['car_brand', 'car_model'].includes(f)),
			)
		}
	}

	const handleClose = () => {
		setClientKind('new')
		setError('')
		setMissingFields([])
		setClientVehicles([])
		setFormData(emptyForm)
		onClose()
	}

	const validateForm = () => {
		const required = []

		if (!formData.client_name) required.push('client_name')
		if (!formData.phone) required.push('phone')
		if (!formData.city) required.push('city')

		if (
			clientKind === 'new' &&
			(formData.client_type === 'ТОО' || formData.client_type === 'ИП') &&
			!formData.company_name
		) {
			required.push('company_name')
		}

		if (!isEditMode) {
			if (!formData.work_date) required.push('work_date')
			if (!formData.car_brand) required.push('car_brand')
			if (!formData.car_model) required.push('car_model')

			if (
				formData.work_format === 'Выезд к клиенту' &&
				!formData.work_address
			) {
				required.push('work_address')
			}
		}

		if (required.length > 0) {
			setMissingFields(required)
			setError('Пожалуйста, заполните все обязательные поля.')
			return false
		}

		return true
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!validateForm()) return

		setLoading(true)

		try {
			const token = localStorage.getItem('access_token')

			const headers = {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			}

			const basePayload = {
				city: formData.city,
				address:
					formData.work_format === 'Выезд к клиенту'
						? formData.work_address
						: null,
				work_type:
					formData.work_type === 'Установка'
						? 'INSTALLATION'
						: formData.work_type === 'Снятие'
							? 'REMOVAL'
							: 'DIAGNOSTIC',
				visit_type:
					formData.work_format === 'Выезд к клиенту' ? 'ON_SITE' : 'IN_OFFICE',
			}

			if (formData.work_type === 'Установка') {
				basePayload.installation = {
					has_beacon: formData.beacon === 'С маяком',
					has_blocking: formData.blocking === 'С блокировкой',
				}
			} else {
				basePayload.installation = null
			}

			if (isEditMode) {
				const updateRes = await fetch(
					`http://127.0.0.1:8000/requests/${editRequestData.id}`,
					{
						method: 'PATCH',
						headers,
						body: JSON.stringify(basePayload),
					},
				)

				if (!updateRes.ok) {
					throw new Error(
						`Ошибка редактирования заявки: ${await updateRes.text()}`,
					)
				}

				onCreated()
				handleClose()
				return
			}

			let finalClientId = formData.client_id
				? parseInt(formData.client_id, 10)
				: null

			if (clientKind === 'new') {
				const clientRes = await fetch('http://127.0.0.1:8000/clients', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						type: mapTypeToDB(formData.client_type),
						name: formData.client_name,
						company_name:
							formData.client_type === 'Физ. лицо'
								? null
								: formData.company_name,
						phone: formData.phone,
					}),
				})

				if (!clientRes.ok) {
					throw new Error(`Ошибка клиента: ${await clientRes.text()}`)
				}

				const clientData = await clientRes.json()
				finalClientId = parseInt(clientData.id || clientData.client_id, 10)
			}

			let finalVehicleId = formData.car_id
				? parseInt(formData.car_id, 10)
				: null

			if (!finalVehicleId) {
				const vehicleRes = await fetch('http://127.0.0.1:8000/vehicles', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						client_id: finalClientId,
						type: formData.car_type,
						brand: formData.car_brand,
						model: formData.car_model,
						plate_number: formData.car_plate || 'Нет',
						vin: formData.car_vin || null,
						year: formData.car_year ? parseInt(formData.car_year, 10) : null,
					}),
				})

				if (!vehicleRes.ok) {
					throw new Error(`Ошибка автомобиля: ${await vehicleRes.text()}`)
				}

				const vehicleData = await vehicleRes.json()
				finalVehicleId = parseInt(vehicleData.id || vehicleData.vehicle_id, 10)
			}

			const requestRes = await fetch('http://127.0.0.1:8000/requests', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					client_id: finalClientId,
					vehicle_id: finalVehicleId,
					...basePayload,
				}),
			})

			if (!requestRes.ok) {
				throw new Error(`Ошибка заявки: ${await requestRes.text()}`)
			}

			const requestData = await requestRes.json()

			if (formData.manager_comment) {
				await fetch('http://127.0.0.1:8000/requests/comments', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						request_id: requestData.request_id,
						message: formData.manager_comment,
					}),
				}).catch(err => console.error(err))
			}

			onCreated()
			handleClose()
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const isExisting = clientKind === 'existing'
  const isClientLocked = isEditMode || (isExisting && !isEditMode)
	const isVehicleLocked = isEditMode || (!isEditMode && formData.car_id !== '')

	const fieldClass = fieldName => {
		return missingFields.includes(fieldName)
			? 'request-modal-input request-field-error'
			: 'request-modal-input'
	}

	return (
		<div className='modal-overlay open'>
			<div className='modal-window request-modal-window'>
				<div className='modal-header'>
					<span className='modal-title'>
						{isEditMode ? 'Редактирование заявки' : 'Создание заявки'}
					</span>

					<button className='modal-close' onClick={handleClose} type='button'>
						&times;
					</button>
				</div>

				{error && <div className='request-modal-error-banner'>{error}</div>}

				<div className='request-modal-body'>
					<form id='request-form' onSubmit={handleSubmit}>
						<div className='request-modal-card'>
							<div className='request-modal-section-title'>Данные клиента</div>

							{!isEditMode && (
								<div className='request-toggle-row'>
									<label className='request-radio-pill'>
										<input
											type='radio'
											value='new'
											checked={clientKind === 'new'}
											onChange={() => setClientKind('new')}
										/>
										Новый клиент
									</label>

									<label className='request-radio-pill'>
										<input
											type='radio'
											value='existing'
											checked={clientKind === 'existing'}
											onChange={() => setClientKind('existing')}
										/>
										Существующий клиент
									</label>
								</div>
							)}

							{isExisting && !isEditMode && (
								<label className='request-modal-field request-modal-full'>
									<span className='request-modal-label required'>
										Выберите клиента
									</span>
									<select
										className='request-modal-input'
										onChange={handleExistingClientSelect}
										value={formData.client_id}
									>
										<option value=''>— выберите —</option>
										{clientsList.map(client => (
											<option key={client.id} value={client.id}>
												{client.company_name || client.name}
											</option>
										))}
									</select>
								</label>
							)}

							<div className='request-modal-grid'>
								<label className='request-modal-field'>
									<span className='request-modal-label required'>Тип лица</span>
									<select
										className='request-modal-input'
										name='client_type'
										value={formData.client_type}
										onChange={handleChange}
										disabled={isClientLocked}
									>
										<option>Физ. лицо</option>
										<option>ИП</option>
										<option>ТОО</option>
									</select>
								</label>

								{(formData.client_type === 'ТОО' ||
									formData.client_type === 'ИП') && (
									<label className='request-modal-field'>
										<span className='request-modal-label required'>
											Наименование
										</span>
										<input
											className={fieldClass('company_name')}
											type='text'
											name='company_name'
											value={formData.company_name}
											onChange={handleChange}
											readOnly={isClientLocked}
										/>
									</label>
								)}

								<label className='request-modal-field'>
									<span className='request-modal-label required'>ФИО</span>
									<input
										className={fieldClass('client_name')}
										type='text'
										name='client_name'
										value={formData.client_name}
										onChange={handleChange}
										readOnly={isClientLocked}
									/>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label required'>
										Контактный номер
									</span>
									<input
										className={fieldClass('phone')}
										type='tel'
										name='phone'
										value={formData.phone}
										onChange={handleChange}
										readOnly={isClientLocked}
									/>
								</label>
							</div>
						</div>

						<div className='request-modal-card'>
							<div className='request-modal-section-title'>
								Организация работ
							</div>

							<div className='request-modal-grid'>
								<label className='request-modal-field'>
									<span className='request-modal-label required'>Город</span>
									<select
										className={fieldClass('city')}
										name='city'
										value={formData.city}
										onChange={handleChange}
									>
										<option value=''>— выберите город —</option>
										<option>Алматы</option>
										<option>Астана</option>
										<option>Шымкент</option>
										<option>Караганда</option>
									</select>
								</label>

								{!isEditMode && (
									<label className='request-modal-field'>
										<span className='request-modal-label required'>
											Дата выполнения
										</span>
										<input
											className={fieldClass('work_date')}
											type='date'
											name='work_date'
											value={formData.work_date}
											onChange={handleChange}
										/>
									</label>
								)}
							</div>

							<div className='request-option-group'>
								<div className='request-modal-label required'>Тип работ</div>

								<div className='request-radio-list'>
									{['Установка', 'Снятие', 'Диагностика'].map(type => (
										<label
											key={type}
											className={`request-radio-pill ${formData.work_type === type ? 'active' : ''}`}
										>
											<input
												type='radio'
												name='work_type'
												value={type}
												checked={formData.work_type === type}
												onChange={handleChange}
												disabled={isEditMode}
											/>
											{type}
										</label>
									))}
								</div>
							</div>

							<div className='request-option-group'>
								<div className='request-modal-label required'>Формат</div>

								<div className='request-radio-list'>
									{['Выезд к клиенту', 'В офисе'].map(format => (
										<label
											key={format}
											className={`request-radio-pill ${formData.work_format === format ? 'active' : ''}`}
										>
											<input
												type='radio'
												name='work_format'
												value={format}
												checked={formData.work_format === format}
												onChange={handleChange}
											/>
											{format}
										</label>
									))}
								</div>
							</div>

							{formData.work_format === 'Выезд к клиенту' && (
								<label className='request-modal-field request-modal-full request-modal-gap-top'>
									<span className='request-modal-label required'>
										Адрес выезда
									</span>
									<input
										className={fieldClass('work_address')}
										type='text'
										name='work_address'
										value={formData.work_address}
										onChange={handleChange}
										placeholder='Укажите точный адрес...'
									/>
								</label>
							)}
						</div>

						<div className='request-modal-card'>
							<div className='request-modal-section-title'>
								Данные транспорта
							</div>

							{isExisting && clientVehicles.length > 0 && !isEditMode && (
								<label className='request-modal-field request-modal-full request-existing-vehicle-box'>
									<span className='request-modal-label'>Выберите авто</span>
									<select
										className='request-modal-input'
										onChange={handleExistingVehicleSelect}
										value={formData.car_id}
									>
										<option value=''>— Новая машина —</option>
										{clientVehicles.map(vehicle => (
											<option key={vehicle.id} value={vehicle.id}>
												{vehicle.brand} {vehicle.model} (
												{vehicle.plate_number || 'б/н'})
											</option>
										))}
									</select>
								</label>
							)}

							<div className='request-modal-grid'>
								<label className='request-modal-field'>
									<span className='request-modal-label required'>
										Тип техники
									</span>
									<select
										className='request-modal-input'
										name='car_type'
										value={formData.car_type}
										onChange={handleChange}
										disabled={isVehicleLocked}
									>
										<option>Легковая</option>
										<option>Электромобиль</option>
										<option>Спецтехника</option>
									</select>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label required'>Марка</span>
									<input
										className={fieldClass('car_brand')}
										type='text'
										name='car_brand'
										value={formData.car_brand}
										onChange={handleChange}
										readOnly={isVehicleLocked}
									/>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label required'>Модель</span>
									<input
										className={fieldClass('car_model')}
										type='text'
										name='car_model'
										value={formData.car_model}
										onChange={handleChange}
										readOnly={isVehicleLocked}
									/>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label'>Год выпуска</span>
									<input
										className='request-modal-input'
										type='number'
										name='car_year'
										value={formData.car_year}
										onChange={handleChange}
										readOnly={isVehicleLocked}
										placeholder='2020'
									/>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label'>VIN-код</span>
									<input
										className='request-modal-input'
										type='text'
										name='car_vin'
										value={formData.car_vin}
										onChange={handleChange}
										readOnly={isVehicleLocked}
										placeholder='17 символов'
										maxLength='17'
									/>
								</label>

								<label className='request-modal-field'>
									<span className='request-modal-label'>Гос. номер</span>
									<input
										className='request-modal-input'
										type='text'
										name='car_plate'
										value={formData.car_plate}
										onChange={handleChange}
										readOnly={isVehicleLocked}
									/>
								</label>
							</div>
						</div>

						{formData.work_type === 'Установка' && (
							<div className='request-modal-card'>
								<div className='request-modal-section-title'>
									Параметры установки
								</div>

								<div className='request-option-group'>
									<div className='request-modal-label'>Блокировка</div>

									<div className='request-radio-list'>
										{['С блокировкой', 'Без блокировки'].map(value => (
											<label
												key={value}
												className={`request-radio-pill ${formData.blocking === value ? 'active' : ''}`}
											>
												<input
													type='radio'
													name='blocking'
													value={value}
													checked={formData.blocking === value}
													onChange={handleChange}
												/>
												{value}
											</label>
										))}
									</div>
								</div>

								<div className='request-option-group'>
									<div className='request-modal-label'>Маяк</div>

									<div className='request-radio-list'>
										{['С маяком', 'Без маяка'].map(value => (
											<label
												key={value}
												className={`request-radio-pill ${formData.beacon === value ? 'active' : ''}`}
											>
												<input
													type='radio'
													name='beacon'
													value={value}
													checked={formData.beacon === value}
													onChange={handleChange}
												/>
												{value}
											</label>
										))}
									</div>
								</div>
							</div>
						)}

						{!isEditMode && (
							<div className='request-modal-card'>
								<div className='request-modal-section-title'>
									Комментарии от менеджера
								</div>

								<label className='request-modal-field'>
									<textarea
										className='request-modal-textarea'
										name='manager_comment'
										rows='3'
										placeholder='Оставьте комментарий к заявке...'
										value={formData.manager_comment}
										onChange={handleChange}
									/>
								</label>
							</div>
						)}
					</form>
				</div>

				<div className='modal-footer request-modal-footer'>
					<button
						className='request-cancel-btn'
						type='button'
						onClick={handleClose}
					>
						Отмена
					</button>

					<button
						className='request-submit-btn'
						type='submit'
						form='request-form'
						disabled={loading}
					>
						{loading
							? 'Сохранение...'
							: isEditMode
								? 'Сохранить изменения'
								: 'Создать заявку'}
					</button>
				</div>
			</div>
		</div>
	)
}
