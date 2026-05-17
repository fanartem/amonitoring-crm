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

const createLocalId = () =>
	crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

const createEmptyExtraSensor = () => ({
	local_id: createLocalId(),
	name: '',
	price: '',
})

const createEmptyRequestVehicle = () => ({
	local_id: createLocalId(),

	car_id: '',
	car_type: 'Легковая',
	car_brand: '',
	car_model: '',
	car_vin: '',
	car_plate: '',
	car_year: '',

	blocking: 'С блокировкой',
	beacon: 'С маяком',
	extra_sensors: [],
})

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
	const [cities, setCities] = useState([])
	
	const [requestVehicles, setRequestVehicles] = useState([
		createEmptyRequestVehicle(),
	])

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

		manager_comment: '',
	}

	useEffect(() => {
		if (!isOpen) return

		fetchClients()
		fetchCities()
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

				manager_comment: '',
			})
		} else {
			setClientKind('new')
			setClientVehicles([])
			setRequestVehicles([createEmptyRequestVehicle()])
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

	const fetchCities = async () => {
		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch('http://127.0.0.1:8000/cities', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (res.ok) {
				const data = await res.json()
				setCities(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
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
			}))

			fetchClientVehicles(client.id)
			setRequestVehicles([createEmptyRequestVehicle()])

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

	const handleExistingVehicleSelect = (localId, selectedId) => {
		if (!selectedId) {
			setRequestVehicles(prev =>
				prev.map(vehicle =>
					vehicle.local_id === localId
						? {
								...vehicle,
								car_id: '',
								car_type: 'Легковая',
								car_brand: '',
								car_model: '',
								car_plate: '',
								car_vin: '',
								car_year: '',
							}
						: vehicle,
				),
			)

			return
		}

		const selectedVehicle = clientVehicles.find(
			v => v.id === Number(selectedId),
		)

		if (!selectedVehicle) return

		setRequestVehicles(prev =>
			prev.map(vehicle =>
				vehicle.local_id === localId
					? {
							...vehicle,
							car_id: selectedVehicle.id,
							car_type: selectedVehicle.type || 'Легковая',
							car_brand: selectedVehicle.brand || '',
							car_model: selectedVehicle.model || '',
							car_plate: selectedVehicle.plate_number || '',
							car_vin: selectedVehicle.vin || '',
							car_year: selectedVehicle.year || '',
						}
					: vehicle,
			),
		)

		setMissingFields(prev =>
			prev.filter(
				f => ![`car_brand_${localId}`, `car_model_${localId}`].includes(f),
			),
		)
	}

	const handleVehicleChange = (localId, fieldName, value) => {
		setRequestVehicles(prev =>
			prev.map(vehicle =>
				vehicle.local_id === localId
					? {
							...vehicle,
							[fieldName]: value,
						}
					: vehicle,
			),
		)

		clearMissingField(`${fieldName}_${localId}`)
	}
	
	const addRequestVehicle = () => {
		setRequestVehicles(prev => [...prev, createEmptyRequestVehicle()])
	}

	const removeRequestVehicle = localId => {
		setRequestVehicles(prev => {
			if (prev.length === 1) return prev
			return prev.filter(vehicle => vehicle.local_id !== localId)
		})
	}
	
	const addExtraSensor = vehicleLocalId => {
		setRequestVehicles(prev =>
			prev.map(vehicle =>
				vehicle.local_id === vehicleLocalId
					? {
							...vehicle,
							extra_sensors: [
								...(vehicle.extra_sensors || []),
								createEmptyExtraSensor(),
							],
						}
					: vehicle,
			),
		)
	}

	const removeExtraSensor = (vehicleLocalId, sensorLocalId) => {
		setRequestVehicles(prev =>
			prev.map(vehicle =>
				vehicle.local_id === vehicleLocalId
					? {
							...vehicle,
							extra_sensors: (vehicle.extra_sensors || []).filter(
								sensor => sensor.local_id !== sensorLocalId,
							),
						}
					: vehicle,
			),
		)
	}

	const handleExtraSensorChange = (
		vehicleLocalId,
		sensorLocalId,
		fieldName,
		value,
	) => {
		setRequestVehicles(prev =>
			prev.map(vehicle =>
				vehicle.local_id === vehicleLocalId
					? {
							...vehicle,
							extra_sensors: (vehicle.extra_sensors || []).map(sensor =>
								sensor.local_id === sensorLocalId
									? {
											...sensor,
											[fieldName]: value,
										}
									: sensor,
							),
						}
					: vehicle,
			),
		)

		clearMissingField(
			`extra_sensor_${fieldName}_${vehicleLocalId}_${sensorLocalId}`,
		)
	}

	const handleClose = () => {
		setClientKind('new')
		setError('')
		setMissingFields([])
		setClientVehicles([])
		setRequestVehicles([createEmptyRequestVehicle()])
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

			requestVehicles.forEach(vehicle => {
				if (!vehicle.car_brand) required.push(`car_brand_${vehicle.local_id}`)
				if (!vehicle.car_model) required.push(`car_model_${vehicle.local_id}`)

				if (formData.work_type === 'Установка') {
					;(vehicle.extra_sensors || []).forEach(sensor => {
						if (!sensor.name.trim()) {
							required.push(
								`extra_sensor_name_${vehicle.local_id}_${sensor.local_id}`,
							)
						}

						if (
							sensor.price !== '' &&
							(Number.isNaN(Number(sensor.price)) || Number(sensor.price) < 0)
						) {
							required.push(
								`extra_sensor_price_${vehicle.local_id}_${sensor.local_id}`,
							)
						}
					})
				}
			})

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

			const finalVehicles = []

			for (const vehicle of requestVehicles) {
				let finalVehicleId = vehicle.car_id
					? parseInt(vehicle.car_id, 10)
					: null

				if (!finalVehicleId) {
					const vehicleRes = await fetch('http://127.0.0.1:8000/vehicles', {
						method: 'POST',
						headers,
						body: JSON.stringify({
							client_id: finalClientId,
							type: vehicle.car_type,
							brand: vehicle.car_brand,
							model: vehicle.car_model,
							plate_number: vehicle.car_plate || 'без ГРНЗ',
							vin: vehicle.car_vin || null,
							year: vehicle.car_year ? parseInt(vehicle.car_year, 10) : null,
						}),
					})

					if (!vehicleRes.ok) {
						throw new Error(`Ошибка автомобиля: ${await vehicleRes.text()}`)
					}

					const vehicleData = await vehicleRes.json()
					finalVehicleId = parseInt(
						vehicleData.id || vehicleData.vehicle_id,
						10,
					)
				}

				finalVehicles.push({
					vehicle_id: finalVehicleId,
					has_beacon:
						formData.work_type === 'Установка'
							? vehicle.beacon === 'С маяком'
							: false,
					has_blocking:
						formData.work_type === 'Установка'
							? vehicle.blocking === 'С блокировкой'
							: false,
					extra_sensors:
						formData.work_type === 'Установка'
							? (vehicle.extra_sensors || [])
									.filter(sensor => sensor.name.trim())
									.map(sensor => ({
										name: sensor.name.trim(),
										price: sensor.price === '' ? 0 : Number(sensor.price),
									}))
							: [],
				})
			}

			const requestRes = await fetch('http://127.0.0.1:8000/requests', {
				method: 'POST',
				headers,
				body: JSON.stringify({
					client_id: finalClientId,
					...basePayload,
					scheduled_at: formData.work_date
						? `${formData.work_date}T00:00:00`
						: null,
					vehicles: finalVehicles,
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

	const fieldClass = fieldName => {
		return missingFields.includes(fieldName)
			? 'request-modal-input request-field-error'
			: 'request-modal-input'
	}

	return (
		<div className='modal-overlay open'>
			<div className='request-modal-window'>
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

										{cities.map(city => (
											<option key={city.id} value={city.name}>
												{city.name}
											</option>
										))}
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

						{!isEditMode && (
							<div className='request-modal-card'>
								<div className='request-modal-card-header'>
									<div className='request-modal-section-title'>
										Автомобили в заявке
									</div>

									<button
										type='button'
										className='request-add-vehicle-btn'
										onClick={addRequestVehicle}
									>
										+ Добавить автомобиль
									</button>
								</div>

								<div className='request-vehicles-form-list'>
									{requestVehicles.map((vehicle, index) => {
										const isVehicleLocked = vehicle.car_id !== ''

										return (
											<div
												key={vehicle.local_id}
												className='request-vehicle-form-card'
											>
												<div className='request-vehicle-form-header'>
													<div className='request-vehicle-form-title'>
														Автомобиль #{index + 1}
													</div>

													{requestVehicles.length > 1 && (
														<button
															type='button'
															className='request-remove-vehicle-btn'
															onClick={() =>
																removeRequestVehicle(vehicle.local_id)
															}
														>
															Удалить
														</button>
													)}
												</div>

												<div className='request-vehicle-two-columns'>
													<div>
														<div className='request-modal-section-subtitle'>
															Данные транспорта
														</div>

														{isExisting && clientVehicles.length > 0 && (
															<label className='request-modal-field request-modal-full request-existing-vehicle-box'>
																<span className='request-modal-label'>
																	Выберите авто
																</span>
																<select
																	className='request-modal-input'
																	onChange={e =>
																		handleExistingVehicleSelect(
																			vehicle.local_id,
																			e.target.value,
																		)
																	}
																	value={vehicle.car_id}
																>
																	<option value=''>— Новая машина —</option>
																	{clientVehicles.map(clientVehicle => (
																		<option
																			key={clientVehicle.id}
																			value={clientVehicle.id}
																		>
																			{clientVehicle.brand}{' '}
																			{clientVehicle.model} (
																			{clientVehicle.plate_number || 'б/н'})
																		</option>
																	))}
																</select>
															</label>
														)}

														<div className='request-modal-grid single-column-mobile'>
															<label className='request-modal-field'>
																<span className='request-modal-label required'>
																	Тип техники
																</span>
																<select
																	className='request-modal-input'
																	value={vehicle.car_type}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_type',
																			e.target.value,
																		)
																	}
																	disabled={isVehicleLocked}
																>
																	<option>Легковая</option>
																	<option>Электромобиль</option>
																	<option>Спецтехника</option>
																</select>
															</label>

															<label className='request-modal-field'>
																<span className='request-modal-label required'>
																	Марка
																</span>
																<input
																	className={
																		missingFields.includes(
																			`car_brand_${vehicle.local_id}`,
																		)
																			? 'request-modal-input request-field-error'
																			: 'request-modal-input'
																	}
																	type='text'
																	value={vehicle.car_brand}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_brand',
																			e.target.value,
																		)
																	}
																	readOnly={isVehicleLocked}
																/>
															</label>

															<label className='request-modal-field'>
																<span className='request-modal-label required'>
																	Модель
																</span>
																<input
																	className={
																		missingFields.includes(
																			`car_model_${vehicle.local_id}`,
																		)
																			? 'request-modal-input request-field-error'
																			: 'request-modal-input'
																	}
																	type='text'
																	value={vehicle.car_model}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_model',
																			e.target.value,
																		)
																	}
																	readOnly={isVehicleLocked}
																/>
															</label>

															<label className='request-modal-field'>
																<span className='request-modal-label'>
																	Год выпуска
																</span>
																<input
																	className='request-modal-input'
																	type='number'
																	value={vehicle.car_year}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_year',
																			e.target.value,
																		)
																	}
																	readOnly={isVehicleLocked}
																	placeholder='2020'
																/>
															</label>

															<label className='request-modal-field'>
																<span className='request-modal-label'>
																	VIN-код
																</span>
																<input
																	className='request-modal-input'
																	type='text'
																	value={vehicle.car_vin}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_vin',
																			e.target.value,
																		)
																	}
																	readOnly={isVehicleLocked}
																	placeholder='17 символов'
																	maxLength='17'
																/>
															</label>

															<label className='request-modal-field'>
																<span className='request-modal-label'>
																	Гос. номер
																</span>
																<input
																	className='request-modal-input'
																	type='text'
																	value={vehicle.car_plate}
																	onChange={e =>
																		handleVehicleChange(
																			vehicle.local_id,
																			'car_plate',
																			e.target.value,
																		)
																	}
																	readOnly={isVehicleLocked}
																/>
															</label>
														</div>
													</div>

													{formData.work_type === 'Установка' && (
														<div className='request-install-params-card'>
															<div className='request-modal-section-subtitle'>
																Параметры установки
															</div>

															<div className='request-option-group'>
																<div className='request-radio-list vertical'>
																	{['С блокировкой', 'Без блокировки'].map(
																		value => (
																			<label
																				key={value}
																				className={`request-radio-pill ${vehicle.blocking === value ? 'active' : ''}`}
																			>
																				<input
																					type='radio'
																					value={value}
																					checked={vehicle.blocking === value}
																					onChange={e =>
																						handleVehicleChange(
																							vehicle.local_id,
																							'blocking',
																							e.target.value,
																						)
																					}
																				/>
																				{value}
																			</label>
																		),
																	)}
																</div>
															</div>

															<div className='request-option-group'>
																<div className='request-radio-list vertical'>
																	{['С маяком', 'Без маяка'].map(value => (
																		<label
																			key={value}
																			className={`request-radio-pill ${vehicle.beacon === value ? 'active' : ''}`}
																		>
																			<input
																				type='radio'
																				value={value}
																				checked={vehicle.beacon === value}
																				onChange={e =>
																					handleVehicleChange(
																						vehicle.local_id,
																						'beacon',
																						e.target.value,
																					)
																				}
																			/>
																			{value}
																		</label>
																	))}
																</div>
															</div>

															<div className='request-extra-sensors-block'>
																<div className='request-extra-sensors-header'>
																	<div className='request-modal-section-subtitle extra-sensors-title'>
																		Дополнительные датчики
																	</div>

																	<button
																		type='button'
																		className='request-add-sensor-btn'
																		onClick={() =>
																			addExtraSensor(vehicle.local_id)
																		}
																	>
																		+ Датчик
																	</button>
																</div>

																{!vehicle.extra_sensors ||
																vehicle.extra_sensors.length === 0 ? (
																	<div className='request-extra-sensors-empty'>
																		Дополнительные датчики не добавлены
																	</div>
																) : (
																	<div className='request-extra-sensors-list'>
																		{vehicle.extra_sensors.map(sensor => (
																			<div
																				key={sensor.local_id}
																				className='request-extra-sensor-row'
																			>
																				<label className='request-modal-field'>
																					<span className='request-modal-label'>
																						Название
																					</span>
																					<input
																						className={
																							missingFields.includes(
																								`extra_sensor_name_${vehicle.local_id}_${sensor.local_id}`,
																							)
																								? 'request-modal-input request-field-error'
																								: 'request-modal-input'
																						}
																						type='text'
																						value={sensor.name}
																						onChange={e =>
																							handleExtraSensorChange(
																								vehicle.local_id,
																								sensor.local_id,
																								'name',
																								e.target.value,
																							)
																						}
																						placeholder='Например: ДУТ'
																					/>
																				</label>

																				<label className='request-modal-field'>
																					<span className='request-modal-label'>
																						Цена, тг
																					</span>
																					<input
																						className={
																							missingFields.includes(
																								`extra_sensor_price_${vehicle.local_id}_${sensor.local_id}`,
																							)
																								? 'request-modal-input request-field-error'
																								: 'request-modal-input'
																						}
																						type='number'
																						min='0'
																						value={sensor.price}
																						onChange={e =>
																							handleExtraSensorChange(
																								vehicle.local_id,
																								sensor.local_id,
																								'price',
																								e.target.value,
																							)
																						}
																						placeholder='0'
																					/>
																				</label>

																				<button
																					type='button'
																					className='request-remove-sensor-btn'
																					onClick={() =>
																						removeExtraSensor(
																							vehicle.local_id,
																							sensor.local_id,
																						)
																					}
																				>
																					×
																				</button>
																			</div>
																		))}
																	</div>
																)}
															</div>
														</div>
													)}
												</div>
											</div>
										)
									})}
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
