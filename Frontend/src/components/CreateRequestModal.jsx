import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
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

	gps_price_code: 'GPS_FMB920',
	tracker_subscription_months: 1,

	blocking: 'С блокировкой',
	beacon: 'С маяком',
	beacon_subscription_months: 1,

	extra_sensors: [],
})

const createEmptyManualPriceLine = () => ({
	local_id: createLocalId(),
	label: '',
	quantity: 1,
	unit_price: '',
})

function SearchableSelect({
	value,
	options,
	placeholder = 'Напишите или выберите',
	onChange,
	getOptionValue,
	getOptionLabel,
	getOptionSearchText,
	disabled = false,
	error = false,
	emptyText = 'Ничего не найдено',
}) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const wrapperRef = useRef(null)

	useEffect(() => {
		const handleClickOutside = event => {
			if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
				setIsOpen(false)
				setQuery('')
			}
		}

		document.addEventListener('mousedown', handleClickOutside)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [])

	const selectedOption = options.find(
		option => String(getOptionValue(option)) === String(value),
	)

	const inputValue = isOpen
		? query
		: selectedOption
			? getOptionLabel(selectedOption)
			: ''

	const normalizedQuery = query.trim().toLowerCase()

	const filteredOptions = normalizedQuery
		? options.filter(option =>
				getOptionSearchText(option).toLowerCase().includes(normalizedQuery),
			)
		: options

	const handleSelect = option => {
		onChange(option)
		setQuery('')
		setIsOpen(false)
	}

	const handleClear = e => {
		e.stopPropagation()
		onChange(null)
		setQuery('')
		setIsOpen(false)
	}

	return (
		<div className='searchable-select' ref={wrapperRef}>
			<div
				className={`searchable-select-control ${error ? 'request-field-error' : ''} ${
					disabled ? 'disabled' : ''
				}`}
				onClick={() => {
					if (!disabled) setIsOpen(true)
				}}
			>
				<input
					type='text'
					value={inputValue}
					disabled={disabled}
					placeholder={placeholder}
					onFocus={() => {
						if (!disabled) {
							setIsOpen(true)
							setQuery('')
						}
					}}
					onChange={e => {
						setQuery(e.target.value)
						setIsOpen(true)
					}}
					onKeyDown={e => {
						if (e.key === 'Escape') {
							setIsOpen(false)
							setQuery('')
						}
					}}
				/>

				{value && !disabled ? (
					<button
						type='button'
						className='searchable-select-clear'
						onClick={handleClear}
					>
						×
					</button>
				) : (
					<span className='searchable-select-arrow'>▾</span>
				)}
			</div>

			{isOpen && !disabled && (
				<div className='searchable-select-dropdown'>
					{filteredOptions.length === 0 ? (
						<div className='searchable-select-empty'>{emptyText}</div>
					) : (
						filteredOptions.slice(0, 80).map(option => (
							<div
								key={getOptionValue(option)}
								className={`searchable-select-option ${
									String(getOptionValue(option)) === String(value)
										? 'selected'
										: ''
								}`}
								onMouseDown={e => {
									e.preventDefault()
									handleSelect(option)
								}}
							>
								{getOptionLabel(option)}
							</div>
						))
					)}

					{filteredOptions.length > 80 && (
						<div className='searchable-select-more'>
							Показаны первые 80 совпадений. Уточните поиск.
						</div>
					)}
				</div>
			)}
		</div>
	)
}

const mapWorkTypeToUI = dbWorkType => {
	if (dbWorkType === 'INSTALLATION') return 'Установка'
	if (dbWorkType === 'REMOVAL') return 'Снятие'
	if (dbWorkType === 'DIAGNOSTIC') return 'Диагностика'
	if (dbWorkType === 'REFLASHING') return 'Перепрошивка'

	return 'Диагностика'
}

const mapWorkTypeToAPI = uiWorkType => {
	if (uiWorkType === 'Установка') return 'INSTALLATION'
	if (uiWorkType === 'Снятие') return 'REMOVAL'
	if (uiWorkType === 'Диагностика') return 'DIAGNOSTIC'
	if (uiWorkType === 'Перепрошивка') return 'REFLASHING'

	return 'DIAGNOSTIC'
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
	const [cities, setCities] = useState([])
	const [priceItems, setPriceItems] = useState([])

	const [requestVehicles, setRequestVehicles] = useState([
		createEmptyRequestVehicle(),
	])

	const [manualPriceLines, setManualPriceLines] = useState([])
	const [priceCalculation, setPriceCalculation] = useState({
		total_price: 0,
		lines: [],
		currency: 'KZT',
	})
	const [priceLoading, setPriceLoading] = useState(false)
	const [priceLineOverrides, setPriceLineOverrides] = useState({})
	const [editingPriceLineKey, setEditingPriceLineKey] = useState(null)
	const [editingPriceLineValue, setEditingPriceLineValue] = useState('')

	const [formData, setFormData] = useState({
		client_id: '',
		client_type: 'Физ. лицо',
		client_name: '',
		phone: '',
		email: '',
		city: '',
		company_name: '',

		is_subclient: false,
		parent_client_id: '',
		parent_source_name: '',

		work_type: 'Установка',
		work_format: 'Выезд к клиенту',
		visit_price_code: 'ON_SITE_CITY',
		visit_km: '',
		has_power_restore: false,
		work_address: '',
		work_date: '',

		platform: '',
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
		email: '',
		city: '',
		company_name: '',

		is_subclient: false,
		parent_client_id: '',
		parent_source_name: '',

		work_type: 'Установка',
		work_format: 'Выезд к клиенту',
		visit_price_code: 'ON_SITE_CITY',
		visit_km: '',
		has_power_restore: false,
		work_address: '',
		work_date: '',

		platform: '',
		manager_comment: '',
	}

	useEffect(() => {
		if (!isOpen) return

		fetchClients()
		fetchCities()
		fetchPriceItems()
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

				is_subclient: false,
				parent_client_id: '',
				parent_source_name: '',

				work_type:
					mapWorkTypeToUI(editRequestData.work_type),

				work_format:
					editRequestData.visit_type === 'ON_SITE'
						? 'Выезд к клиенту'
						: 'В офисе',

				visit_price_code:
					editRequestData.visit_type === 'ON_SITE' ? 'ON_SITE_CITY' : '',
				visit_km: '',
				has_power_restore: false,

				work_address: editRequestData.address || '',
				work_date: '',

				platform: editRequestData.platform || '',
				manager_comment: '',
			})
		} else {
			setClientKind('new')
			setClientVehicles([])
			setRequestVehicles([createEmptyRequestVehicle()])
			setFormData(emptyForm)
		}
	}, [isOpen, editRequestData, isEditMode])

	useEffect(() => {
		if (!isOpen || isEditMode) return

		const timeout = setTimeout(() => {
			calculatePrice()
		}, 400)

		return () => clearTimeout(timeout)
	}, [isOpen, isEditMode, formData, requestVehicles, manualPriceLines])

	useEffect(() => {
		if (!isOpen || isEditMode) return
		if (gpsTrackerItems.length === 0) return

		setRequestVehicles(prev =>
			prev.map(vehicle => {
				const currentCode = vehicle.gps_price_code

				if (currentCode === '') return vehicle

				const exists = gpsTrackerItems.some(item => item.code === currentCode)

				if (exists) return vehicle

				return {
					...vehicle,
					gps_price_code: gpsTrackerItems[0].code,
				}
			}),
		)
	}, [isOpen, isEditMode, priceItems])

	const fetchClients = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients`, {
				headers: getAuthHeaders(),
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
			const res = await fetch(`${API_BASE_URL}/cities`)

			if (res.ok) {
				const data = await res.json()
				setCities(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
		}
	}

	const fetchPriceItems = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/prices?active_only=true`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setPriceItems(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки цен:', err)
		}
	}

	const fetchClientVehicles = async clientId => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles?client_id=${clientId}`,
				{
					headers: getAuthHeaders(),
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
		const { name, value, type, checked } = e.target

		setFormData(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))

		clearMissingField(name)
	}

	const getClientLabel = client => {
		if (!client) return ''

		const mainName =
			client.company_name || client.name || `Клиент #${client.id}`
		const representative =
			client.company_name && client.name ? ` — ${client.name}` : ''
		const parent = client.source_parent_client_name
			? ` / родитель: ${client.source_parent_client_name}`
			: ''

		const status = client.status || 'ACTIVE'
		const statusText =
			status !== 'ACTIVE' ? ` / статус: ${getClientStatusLabel(status)}` : ''

		const responsible = client.responsible_manager_name
			? ` / ответственный: ${client.responsible_manager_name}`
			: ''

		return `${mainName}${representative}${parent}${statusText}${responsible}`
	}

	const getClientSearchText = client => {
		return [
			client.company_name,
			client.name,
			client.phone,
			client.email,
			client.source_client_name,
			client.source_parent_client_name,
			client.source_inn,
		]
			.filter(Boolean)
			.join(' ')
	}

	const getClientSourceName = client => {
		if (!client) return ''

		return (
			client.source_client_name ||
			client.company_name ||
			client.name ||
			`Клиент #${client.id}`
		)
	}

	const getClientStatusLabel = status => {
		if (status === 'ACTIVE') return 'Активный'
		if (status === 'DEBTOR') return 'Должник'
		if (status === 'BLOCKED') return 'Заблокирован'

		return status || 'Активный'
	}

	const handleParentClientSelect = parentClient => {
		setFormData(prev => ({
			...prev,
			parent_client_id: parentClient ? parentClient.id : '',
			parent_source_name: parentClient ? getClientSourceName(parentClient) : '',
		}))

		clearMissingField('parent_client_id')
	}

	const getCityLabel = city => city.name

	const getCitySearchText = city => city.name || ''

	const getVehicleLabel = vehicle => {
		const title = `${vehicle.brand || ''} ${vehicle.model || ''}`.trim()
		const plate = vehicle.plate_number || 'б/н'
		const vin = vehicle.vin || 'VIN не указан'

		return `${title || 'Автомобиль'} (${plate}) · ${vin}`
	}

	const getVehicleSearchText = vehicle => {
		return [
			vehicle.brand,
			vehicle.model,
			vehicle.plate_number,
			vehicle.vin,
			vehicle.year,
			vehicle.type,
		]
			.filter(Boolean)
			.join(' ')
	}

	const handleExistingClientSelect = client => {
		if (client) {
			setFormData(prev => ({
				...prev,
				client_id: client.id,
				client_type: mapTypeToUI(client.type || client.client_type),
				client_name: client.name || '',
				phone: client.phone || '',
				email: client.email || '',
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
				email: '',
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
			prev.map(vehicle => {
				if (vehicle.local_id !== localId) return vehicle

				if (fieldName === 'gps_price_code' && value === '') {
					return {
						...vehicle,
						gps_price_code: '',
						tracker_subscription_months: 0,
						blocking: 'Без блокировки',
					}
				}

				if (fieldName === 'gps_price_code' && value !== '') {
					return {
						...vehicle,
						gps_price_code: value,
						tracker_subscription_months:
							Number(vehicle.tracker_subscription_months) > 0
								? vehicle.tracker_subscription_months
								: 1,
					}
				}

				return {
					...vehicle,
					[fieldName]: value,
				}
			}),
		)

		clearMissingField(`${fieldName}_${localId}`)
	}

	const addRequestVehicle = () => {
		setRequestVehicles(prev => [...prev, createVehicleWithDefaultGps()])
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

	const addManualPriceLine = () => {
		setManualPriceLines(prev => [...prev, createEmptyManualPriceLine()])
	}

	const removeManualPriceLine = localId => {
		setManualPriceLines(prev => prev.filter(line => line.local_id !== localId))
	}

	const handleManualPriceLineChange = (localId, fieldName, value) => {
		setManualPriceLines(prev =>
			prev.map(line =>
				line.local_id === localId
					? {
						...line,
						[fieldName]: value,
					}
					: line,
			),
		)
	}

	const handleClose = () => {
		setClientKind('new')
		setError('')
		setMissingFields([])
		setClientVehicles([])
		setRequestVehicles([createEmptyRequestVehicle()])
		setManualPriceLines([])
		setPriceCalculation({
			total_price: 0,
			lines: [],
			currency: 'KZT',
		})
		setPriceLineOverrides({})
		setEditingPriceLineKey(null)
		setEditingPriceLineValue('')
		setFormData(emptyForm)
		onClose()
	}

	const validateForm = () => {
		const required = []

		if (!formData.client_name.trim()) required.push('client_name')
		if (!formData.phone.trim()) required.push('phone')
		if (!formData.city.trim()) required.push('city')
		if (!formData.platform.trim()) required.push('platform')

		if (clientRequestBlocked) {
			setError(
				'Клиент заблокирован. Создание заявки для заблокированного клиента запрещено.',
			)
			return false
		}

		if (
			clientKind === 'new' &&
			(formData.client_type === 'ТОО' || formData.client_type === 'ИП') &&
			!formData.company_name.trim()
		) {
			required.push('company_name')
		}

		if (
			clientKind === 'new' &&
			formData.is_subclient &&
			!formData.parent_client_id
		) {
			required.push('parent_client_id')
		}

		if (!isEditMode) {
			if (!formData.work_date) required.push('work_date')

			requestVehicles.forEach(vehicle => {
				if (!vehicle.car_brand) required.push(`car_brand_${vehicle.local_id}`)
				if (!vehicle.car_model) required.push(`car_model_${vehicle.local_id}`)
				if (!vehicle.car_vin || !vehicle.car_vin.trim()) {
					required.push(`car_vin_${vehicle.local_id}`)
				}

				if (formData.work_type === 'Установка') {
					; (vehicle.extra_sensors || []).forEach(sensor => {
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

	const getErrorMessage = async response => {
		try {
			const data = await response.json()

			if (typeof data.detail === 'string') {
				return data.detail
			}

			if (Array.isArray(data.detail)) {
				return data.detail
					.map(item => item.msg || item.detail || JSON.stringify(item))
					.join('\n')
			}

			return JSON.stringify(data)
		} catch {
			return await response.text()
		}
	}

	const checkVehicleVinExists = async vin => {
		const normalizedVin = vin.trim().toUpperCase()

		if (!normalizedVin) return null

		const res = await fetch(
			`${API_BASE_URL}/vehicles/check-vin?vin=${encodeURIComponent(normalizedVin)}`,
			{
				headers: getAuthHeaders(),
			},
		)

		if (!res.ok) {
			throw new Error(await getErrorMessage(res))
		}

		const data = await res.json()

		if (!data.exists) return null

		return data.vehicle || { vin: normalizedVin }
	}

	const validateDuplicateVinsInForm = () => {
		const vinMap = new Map()

		for (const vehicle of requestVehicles) {
			if (vehicle.car_id) continue

			const vin = vehicle.car_vin?.trim().toUpperCase()

			if (!vin) continue

			if (vinMap.has(vin)) {
				throw new Error(
					`VIN ${vin} указан у нескольких автомобилей в этой заявке`,
				)
			}

			vinMap.set(vin, true)
		}
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!validateForm()) return

		setLoading(true)

		try {
			const headers = getJsonAuthHeaders()

			validateDuplicateVinsInForm()

			for (const vehicle of requestVehicles) {
				if (vehicle.car_id) continue

				const vin = vehicle.car_vin?.trim()

				if (!vin) continue

				const existingVehicle = await checkVehicleVinExists(vin)

				if (existingVehicle) {
					const existingVehicleText = [
						existingVehicle.brand,
						existingVehicle.model,
						existingVehicle.plate_number
							? `(${existingVehicle.plate_number})`
							: '',
					]
						.filter(Boolean)
						.join(' ')

					const clientText =
						existingVehicle.company_name ||
						existingVehicle.client_name ||
						'клиент не указан'

					const isDeletedClient = Boolean(existingVehicle.client_is_deleted)

					if (isDeletedClient) {
						throw new Error(
							`Автомобиль с VIN ${vin.toUpperCase()} уже существует у клиента "${clientText}", который находится в корзине. Восстановите клиента или проверьте правильность VIN.`,
						)
					}

					throw new Error(
						`Автомобиль с VIN ${vin.toUpperCase()} уже существует: ${existingVehicleText || 'автомобиль без названия'}. Клиент: ${clientText}`,
					)
				}
			}

			const basePayload = {
				city: formData.city,
				address:
					formData.work_format === 'Выезд к клиенту'
						? formData.work_address
						: null,
				work_type: mapWorkTypeToAPI(formData.work_type),
				visit_type:
					formData.work_format === 'Выезд к клиенту' ? 'ON_SITE' : 'IN_OFFICE',
				platform: formData.platform.trim(),
			}

			if (isEditMode) {
				const updateRes = await fetch(
					`${API_BASE_URL}/requests/${editRequestData.id}`,
					{
						method: 'PATCH',
						headers,
						body: JSON.stringify(basePayload),
					},
				)

				if (!updateRes.ok) {
					throw new Error(
						`Ошибка редактирования заявки: ${await getErrorMessage(updateRes)}`,
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
				const clientRes = await fetch(`${API_BASE_URL}/clients`, {
					method: 'POST',
					headers,
					body: JSON.stringify({
						type: mapTypeToDB(formData.client_type),
						name: formData.client_name.trim(),
						company_name:
							formData.client_type === 'Физ. лицо'
								? null
								: formData.company_name.trim(),
						phone: formData.phone.trim(),
						email: formData.email.trim() || null,

						source_system: formData.is_subclient ? 'CRM' : null,
						source_client_name:
							formData.client_type === 'Физ. лицо'
								? formData.client_name.trim()
								: formData.company_name.trim(),
						source_parent_client_name: formData.is_subclient
							? formData.parent_source_name
							: null,
						source_inn: null,
					}),
				})

				if (!clientRes.ok) {
					throw new Error(await getErrorMessage(clientRes))
				}

				const clientData = await clientRes.json()
				finalClientId = parseInt(clientData.id || clientData.client_id, 10)

				setFormData(prev => ({
					...prev,
					client_id: finalClientId,
				}))

				setClientKind('existing')

				setClientsList(prev => [
					...prev,
					{
						id: finalClientId,
						type: mapTypeToDB(formData.client_type),
						name: formData.client_name.trim(),
						company_name:
							formData.client_type === 'Физ. лицо'
								? null
								: formData.company_name.trim(),
						phone: formData.phone.trim(),
						email: formData.email.trim() || null,
						source_system: formData.is_subclient ? 'CRM' : null,
						source_client_name:
							formData.client_type === 'Физ. лицо'
								? formData.client_name.trim()
								: formData.company_name.trim(),
						source_parent_client_name: formData.is_subclient
							? formData.parent_source_name
							: null,
						source_inn: null,
					},
				])
			}

			const finalVehicles = []

			for (const vehicle of requestVehicles) {
				let finalVehicleId = vehicle.car_id
					? parseInt(vehicle.car_id, 10)
					: null

				if (!finalVehicleId) {
					const vehicleRes = await fetch(`${API_BASE_URL}/vehicles`, {
						method: 'POST',
						headers,
						body: JSON.stringify({
							client_id: finalClientId,
							type: vehicle.car_type,
							brand: vehicle.car_brand,
							model: vehicle.car_model,
							plate_number: vehicle.car_plate || 'без ГРНЗ',
							vin: vehicle.car_vin.trim().toUpperCase(),
							year: vehicle.car_year ? parseInt(vehicle.car_year, 10) : null,
						}),
					})

					if (!vehicleRes.ok) {
						throw new Error(await getErrorMessage(vehicleRes))
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
						formData.work_type === 'Установка' && vehicle.gps_price_code
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

			const requestPricePayload = buildRequestPricePayload()

			const requestRes = await fetch(`${API_BASE_URL}/requests`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					client_id: finalClientId,
					...basePayload,
					scheduled_at: formData.work_date
						? `${formData.work_date}T00:00:00`
						: null,
					vehicles: finalVehicles,
					price: requestPricePayload,
				}),
			})

			if (!requestRes.ok) {
				throw new Error(await getErrorMessage(requestRes))
			}

			const requestData = await requestRes.json()

			if (formData.manager_comment) {
				await fetch(`${API_BASE_URL}/requests/comments`, {
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

	const selectedExistingClient = clientsList.find(
		client => String(client.id) === String(formData.client_id),
	)

	const selectedExistingClientStatus =
		selectedExistingClient?.status || 'ACTIVE'

	const isSelectedClientDebtor =
		clientKind === 'existing' &&
		!isEditMode &&
		selectedExistingClientStatus === 'DEBTOR'

	const isSelectedClientBlocked =
		clientKind === 'existing' &&
		!isEditMode &&
		selectedExistingClientStatus === 'BLOCKED'

	const clientRequestBlocked = isSelectedClientBlocked

	const fieldClass = fieldName => {
		return missingFields.includes(fieldName)
			? 'request-modal-input request-field-error'
			: 'request-modal-input'
	}

	const getWorkTypeForApi = () => {
		return mapWorkTypeToAPI(formData.work_type)
	}

	const getVisitTypeForApi = () => {
		return formData.work_format === 'Выезд к клиенту' ? 'ON_SITE' : 'IN_OFFICE'
	}

	const buildPriceCalculationPayload = () => {
		const workType = getWorkTypeForApi()
		const visitType = getVisitTypeForApi()

		return {
			client_id: formData.client_id ? Number(formData.client_id) : null,
			work_type: workType,
			visit_type: visitType,
			visit_price_code:
				visitType === 'ON_SITE'
					? formData.visit_price_code || 'ON_SITE_CITY'
					: null,
			visit_km:
				visitType === 'ON_SITE' &&
					formData.visit_price_code === 'BUSINESS_TRIP_KM' &&
					formData.visit_km !== ''
					? Number(formData.visit_km)
					: null,
			has_power_restore:
				workType === 'DIAGNOSTIC' ? Boolean(formData.has_power_restore) : false,
			vehicles: requestVehicles.map(vehicle => ({
				gps_price_code:
					workType === 'INSTALLATION' && vehicle.gps_price_code
						? vehicle.gps_price_code
						: null,
				tracker_subscription_months:
					workType === 'INSTALLATION'
						? Number(vehicle.tracker_subscription_months || 0)
						: 0,
				has_beacon:
					workType === 'INSTALLATION' ? vehicle.beacon === 'С маяком' : false,
				beacon_subscription_months:
					workType === 'INSTALLATION' && vehicle.beacon === 'С маяком'
						? Number(vehicle.beacon_subscription_months || 0)
						: 0,
				has_blocking:
					workType === 'INSTALLATION' && vehicle.gps_price_code
						? vehicle.blocking === 'С блокировкой'
						: false,
				extra_sensors:
					workType === 'INSTALLATION'
						? (vehicle.extra_sensors || [])
							.filter(sensor => sensor.name.trim())
							.map(sensor => ({
								name: sensor.name.trim(),
								price: sensor.price === '' ? 0 : Number(sensor.price),
							}))
						: [],
			})),
			manual_lines: manualPriceLines
				.filter(line => line.label.trim())
				.map(line => ({
					label: line.label.trim(),
					quantity: line.quantity === '' ? 1 : Number(line.quantity),
					unit_price: line.unit_price === '' ? 0 : Number(line.unit_price),
				})),
		}
	}

	const getPriceLineUiKey = (line, index) => {
		return `${line.line_key || line.label || 'line'}-${index}`
	}

	const buildDisplayedPriceCalculation = () => {
		const sourceLines = Array.isArray(priceCalculation.lines)
			? priceCalculation.lines
			: []

		const lines = sourceLines.map((line, index) => {
			const uiKey = getPriceLineUiKey(line, index)
			const overrideValue = priceLineOverrides[uiKey]

			if (overrideValue === undefined) {
				return line
			}

			const quantity = Number(line.quantity || 1)
			const unitPrice = Number(overrideValue || 0)

			return {
				...line,
				unit_price: unitPrice,
				total_price: quantity * unitPrice,
				source: 'manual',
				is_manual: true,
			}
		})

		return {
			...priceCalculation,
			lines,
			total_price: lines.reduce(
				(sum, line) => sum + Number(line.total_price || 0),
				0,
			),
		}
	}

	const startEditPriceLine = (line, index) => {
		const uiKey = getPriceLineUiKey(line, index)

		setEditingPriceLineKey(uiKey)
		setEditingPriceLineValue(
			priceLineOverrides[uiKey] !== undefined
				? priceLineOverrides[uiKey]
				: line.unit_price,
		)
	}

	const cancelEditPriceLine = () => {
		setEditingPriceLineKey(null)
		setEditingPriceLineValue('')
	}

	const saveEditPriceLine = () => {
		const value = Number(editingPriceLineValue)

		if (Number.isNaN(value) || value < 0) {
			setError('Цена строки должна быть числом не меньше 0')
			return
		}

		setPriceLineOverrides(prev => ({
			...prev,
			[editingPriceLineKey]: value,
		}))

		cancelEditPriceLine()
	}

	const resetEditPriceLine = uiKey => {
		setPriceLineOverrides(prev => {
			const next = { ...prev }
			delete next[uiKey]
			return next
		})

		if (editingPriceLineKey === uiKey) {
			cancelEditPriceLine()
		}
	}

	const buildRequestPricePayload = () => {
		const displayedCalculation = buildDisplayedPriceCalculation()
		const lines = Array.isArray(displayedCalculation.lines)
			? displayedCalculation.lines
			: []

		return {
			total_price: Number(displayedCalculation.total_price || 0),
			lines: lines.map(line => ({
				line_key: line.line_key || null,
				vehicle_index: line.vehicle_index || null,
				code: line.code || null,
				label: line.label || 'Строка расчёта',
				quantity: Number(line.quantity || 1),
				unit: line.unit || 'шт',
				unit_price: Number(line.unit_price || 0),
				total_price: Number(line.total_price || 0),
				source: line.source || 'base',
				is_manual: line.is_manual || line.source === 'manual',
			})),
		}
	}

	const calculatePrice = async () => {
		if (isEditMode) return

		try {
			setPriceLoading(true)

			const res = await fetch(`${API_BASE_URL}/prices/calculate-request`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(buildPriceCalculationPayload()),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось рассчитать стоимость')
			}

			const data = await res.json()
			setPriceCalculation(data)
		} catch (err) {
			console.error('Ошибка расчёта цены:', err)
		} finally {
			setPriceLoading(false)
		}
	}

	const formatMoney = value => {
		const number = Number(value || 0)

		if (Number.isNaN(number)) return `${value} тг`

		return `${number.toLocaleString('ru-RU')} тг`
	}

	const gpsTrackerItems = priceItems.filter(
		item => item.category === 'GPS_TRACKER' && item.is_active,
	)

	const createVehicleWithDefaultGps = () => {
		const firstGpsCode = gpsTrackerItems[0]?.code || 'GPS_FMB920'

		return {
			...createEmptyRequestVehicle(),
			gps_price_code: firstGpsCode,
		}
	}

	const displayedPriceCalculation = buildDisplayedPriceCalculation()

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
					<div className='request-modal-main-layout'>
						<form id='request-form' onSubmit={handleSubmit}>
							<div className='request-modal-card'>
								<div className='request-modal-section-title'>
									Данные клиента
								</div>

								{!isEditMode && (
									<div className='request-toggle-row'>
										<label className='request-radio-pill'>
											<input
												type='radio'
												value='new'
												checked={clientKind === 'new'}
												onChange={() => {
													setClientKind('new')
													setFormData(prev => ({
														...prev,
														client_id: '',
														is_subclient: false,
														parent_client_id: '',
														parent_source_name: '',
													}))
												}}
											/>
											Новый клиент
										</label>

										<label className='request-radio-pill'>
											<input
												type='radio'
												value='existing'
												checked={clientKind === 'existing'}
												onChange={() => {
													setClientKind('existing')
													setFormData(prev => ({
														...prev,
														is_subclient: false,
														parent_client_id: '',
														parent_source_name: '',
													}))
												}}
											/>
											Существующий клиент
										</label>
									</div>
								)}

								{clientKind === 'new' && !isEditMode && (
									<div className='request-subclient-block'>
										<label
											className={`request-subclient-pill ${formData.is_subclient ? 'active' : ''}`}
										>
											<input
												type='checkbox'
												checked={formData.is_subclient}
												onChange={e => {
													const checked = e.target.checked

													setFormData(prev => ({
														...prev,
														is_subclient: checked,
														parent_client_id: checked
															? prev.parent_client_id
															: '',
														parent_source_name: checked
															? prev.parent_source_name
															: '',
													}))

													if (!checked) {
														clearMissingField('parent_client_id')
													}
												}}
											/>

											<span className='request-subclient-checkmark'>
												{formData.is_subclient ? '✓' : ''}
											</span>

											<span>Клиент является подклиентом</span>
										</label>

										{formData.is_subclient && (
											<label className='request-modal-field request-modal-full request-modal-gap-top'>
												<span className='request-modal-label required'>
													Родительский клиент
												</span>

												<SearchableSelect
													value={formData.parent_client_id}
													options={clientsList}
													placeholder='Напишите или выберите родительского клиента'
													onChange={handleParentClientSelect}
													getOptionValue={client => client.id}
													getOptionLabel={getClientLabel}
													getOptionSearchText={getClientSearchText}
													error={missingFields.includes('parent_client_id')}
													emptyText='Родительский клиент не найден'
												/>
											</label>
										)}
									</div>
								)}

								{isExisting && !isEditMode && (
									<div className='request-modal-field request-modal-full'>
										<span className='request-modal-label required'>
											Выберите клиента
										</span>

										<SearchableSelect
											value={formData.client_id}
											options={clientsList}
											placeholder='Напишите или выберите клиента'
											onChange={handleExistingClientSelect}
											getOptionValue={client => client.id}
											getOptionLabel={getClientLabel}
											getOptionSearchText={getClientSearchText}
											error={missingFields.includes('client_id')}
											emptyText='Клиент не найден'
										/>

										{isSelectedClientDebtor && (
											<div className='request-client-status-warning debtor'>
												<div className='request-client-status-warning-title'>
													Клиент в статусе “Должник”
												</div>
												<div className='request-client-status-warning-text'>
													Заявку создать можно, но перед выполнением работ
													проверьте оплату или согласуйте выполнение с
													ответственным менеджером.
												</div>
											</div>
										)}

										{isSelectedClientBlocked && (
											<div className='request-client-status-warning blocked'>
												<div className='request-client-status-warning-title'>
													Клиент заблокирован
												</div>
												<div className='request-client-status-warning-text'>
													Создание заявки для этого клиента запрещено. Сначала
													измените статус клиента на “Активный” или “Должник”.
												</div>
											</div>
										)}
									</div>
								)}

								<div className='request-modal-grid'>
									<label className='request-modal-field'>
										<span className='request-modal-label required'>
											Тип лица
										</span>
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

									<label className='request-modal-field'>
										<span className='request-modal-label'>Email</span>
										<input
											className='request-modal-input'
											type='email'
											name='email'
											value={formData.email}
											onChange={handleChange}
											readOnly={isClientLocked}
											placeholder='example@mail.com'
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
										<SearchableSelect
											value={formData.city}
											options={cities}
											placeholder='Напишите или выберите город'
											onChange={city => {
												setFormData(prev => ({
													...prev,
													city: city ? city.name : '',
												}))

												clearMissingField('city')
											}}
											getOptionValue={city => city.name}
											getOptionLabel={getCityLabel}
											getOptionSearchText={getCitySearchText}
											error={missingFields.includes('city')}
											emptyText='Город не найден'
										/>
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
										{['Установка', 'Снятие', 'Диагностика', 'Перепрошивка'].map(
											type => (
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
											),
										)}
									</div>
								</div>

								{formData.work_type === 'Диагностика' && (
									<label className='request-checkbox-line'>
										<input
											type='checkbox'
											name='has_power_restore'
											checked={formData.has_power_restore}
											onChange={handleChange}
										/>
										<span>Добавить восстановление питания в расчёт</span>
									</label>
								)}

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
									<div className='request-modal-grid request-modal-gap-top'>
										<label className='request-modal-field'>
											<span className='request-modal-label'>Тип выезда</span>
											<select
												className='request-modal-input'
												name='visit_price_code'
												value={formData.visit_price_code}
												onChange={handleChange}
											>
												<option value='ON_SITE_CITY'>В черте города</option>
												<option value='ON_SITE_OUTSIDE_CITY'>
													За пределы города
												</option>
												<option value='BUSINESS_TRIP_KM'>
													Командировка / по километражу
												</option>
											</select>
										</label>

										{formData.visit_price_code === 'BUSINESS_TRIP_KM' && (
											<label className='request-modal-field'>
												<span className='request-modal-label'>Километраж</span>
												<input
													className='request-modal-input'
													type='number'
													min='0'
													name='visit_km'
													value={formData.visit_km}
													onChange={handleChange}
													placeholder='Например: 120'
												/>
											</label>
										)}
									</div>
								)}

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
																	<SearchableSelect
																		value={vehicle.car_id}
																		options={[
																			{
																				id: '',
																				brand: 'Новая машина',
																				model: '',
																				plate_number: '',
																				vin: '',
																			},
																			...clientVehicles,
																		]}
																		placeholder='Напишите или выберите авто'
																		onChange={selectedVehicle => {
																			handleExistingVehicleSelect(
																				vehicle.local_id,
																				selectedVehicle
																					? selectedVehicle.id
																					: '',
																			)
																		}}
																		getOptionValue={clientVehicle =>
																			clientVehicle.id
																		}
																		getOptionLabel={clientVehicle =>
																			clientVehicle.id === ''
																				? '— Новая машина —'
																				: getVehicleLabel(clientVehicle)
																		}
																		getOptionSearchText={clientVehicle =>
																			clientVehicle.id === ''
																				? 'Новая машина'
																				: getVehicleSearchText(clientVehicle)
																		}
																		emptyText='Авто не найдено'
																	/>
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
																	<span className='request-modal-label required'>
																		VIN-код
																	</span>
																	<input
																		className={fieldClass(
																			`car_vin_${vehicle.local_id}`,
																		)}
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

																<label className='request-modal-field request-modal-full'>
																	<span className='request-modal-label'>
																		Трекер
																	</span>
																	<select
																		className='request-modal-input'
																		value={vehicle.gps_price_code}
																		onChange={e =>
																			handleVehicleChange(
																				vehicle.local_id,
																				'gps_price_code',
																				e.target.value,
																			)
																		}
																	>
																		{gpsTrackerItems.map(item => (
																			<option key={item.id} value={item.code}>
																				{item.name} —{' '}
																				{formatMoney(item.default_price)}
																			</option>
																		))}

																		<option value=''>
																			Без GPS / только маяк
																		</option>
																	</select>
																</label>

																{vehicle.gps_price_code && (
																	<label className='request-modal-field request-modal-full'>
																		<span className='request-modal-label'>
																			Подписка трекера, мес.
																		</span>
																		<input
																			className='request-modal-input'
																			type='number'
																			min='0'
																			value={
																				vehicle.tracker_subscription_months
																			}
																			onChange={e =>
																				handleVehicleChange(
																					vehicle.local_id,
																					'tracker_subscription_months',
																					e.target.value,
																				)
																			}
																		/>
																	</label>
																)}

																{vehicle.gps_price_code && (
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
																							checked={
																								vehicle.blocking === value
																							}
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
																)}

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

																{vehicle.beacon === 'С маяком' && (
																	<label className='request-modal-field request-modal-full'>
																		<span className='request-modal-label'>
																			Подписка маяка, мес.
																		</span>
																		<input
																			className='request-modal-input'
																			type='number'
																			min='0'
																			value={vehicle.beacon_subscription_months}
																			onChange={e =>
																				handleVehicleChange(
																					vehicle.local_id,
																					'beacon_subscription_months',
																					e.target.value,
																				)
																			}
																		/>
																	</label>
																)}

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
																							placeholder='Имя датчика'
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

							{isEditMode && (
								<div className='request-modal-card'>
									<div className='request-modal-section-title'>
										Платформа мониторинга
									</div>

									<div className='request-option-group'>
										<div className='request-modal-label'>
											Выберите платформу
										</div>
										<div className='request-radio-list'>
											{['Wialon', 'GLONASS Soft', 'Amonitoring'].map(p => (
												<label
													key={p}
													className={`request-radio-pill ${formData.platform === p ? 'active' : ''}`}
												>
													<input
														type='radio'
														name='platform'
														value={p}
														checked={formData.platform === p}
														onChange={() =>
															setFormData(prev => ({
																...prev,
																platform: p,
															}))
														}
													/>
													{p}
												</label>
											))}
										</div>
									</div>
								</div>
							)}

							{!isEditMode && (
								<div className='request-modal-card'>
									<div className='request-modal-section-title'>
										Платформа мониторинга
									</div>

									<div
										className={
											missingFields.includes('platform')
												? 'request-option-group request-field-error-box'
												: 'request-option-group'
										}
									>
										<div className='request-modal-label required'>
											Выберите платформу
										</div>
										<div className='request-radio-list'>
											{['Wialon', 'GLONASS Soft', 'Amonitoring'].map(p => (
												<label
													key={p}
													className={`request-radio-pill ${formData.platform === p ? 'active' : ''}`}
												>
													<input
														type='radio'
														name='platform'
														value={p}
														checked={formData.platform === p}
														onChange={() => {
															setFormData(prev => ({
																...prev,
																platform: p,
															}))

															clearMissingField('platform')
														}}
													/>
													{p}
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

						{!isEditMode && (
							<aside className='request-price-panel'>
								<div className='request-price-panel-title'>
									Расчёт стоимости
								</div>

								{priceLoading ? (
									<div className='request-price-empty'>Расчёт...</div>
								) : displayedPriceCalculation.lines.length === 0 ? (
									<div className='request-price-empty'>
										Нет строк для расчёта
									</div>
								) : (
									<div className='request-price-lines'>
										{displayedPriceCalculation.lines.map((line, index) => (
											<div
												key={line.line_key || index}
												className='request-price-line'
											>
												<div className='request-price-line-main'>
													<div className='request-price-line-label'>
														{line.label}
													</div>
													<div className='request-price-line-meta'>
														{line.quantity} {line.unit || 'шт'} ×{' '}
														{formatMoney(line.unit_price)}
														{line.source === 'client_override' && (
															<span className='request-price-source'>
																инд. цена
															</span>
														)}
													</div>
												</div>

												<div className='request-price-line-actions'>
													{editingPriceLineKey ===
													getPriceLineUiKey(line, index) ? (
														<>
															<input
																className='request-price-edit-input'
																type='number'
																min='0'
																value={editingPriceLineValue}
																onChange={e =>
																	setEditingPriceLineValue(e.target.value)
																}
															/>

															<button
																type='button'
																className='request-price-save-line-btn'
																onClick={saveEditPriceLine}
															>
																✓
															</button>

															<button
																type='button'
																className='request-price-cancel-line-btn'
																onClick={cancelEditPriceLine}
															>
																×
															</button>
														</>
													) : (
														<>
															<div className='request-price-line-total'>
																{formatMoney(line.total_price)}
															</div>

															<button
																type='button'
																className='request-price-edit-line-btn'
																onClick={() => startEditPriceLine(line, index)}
																title='Изменить цену только для этой заявки'
															>
																✎
															</button>

															{priceLineOverrides[
																getPriceLineUiKey(line, index)
															] !== undefined && (
																<button
																	type='button'
																	className='request-price-reset-line-btn'
																	onClick={() =>
																		resetEditPriceLine(
																			getPriceLineUiKey(line, index),
																		)
																	}
																	title='Вернуть исходную цену'
																>
																	↺
																</button>
															)}
														</>
													)}
												</div>
											</div>
										))}
									</div>
								)}

								<div className='request-manual-lines'>
									<div className='request-price-panel-subtitle'>
										Ручные строки
									</div>

									{manualPriceLines.map(line => (
										<div
											key={line.local_id}
											className='request-manual-line-row'
										>
											<input
												className='request-modal-input'
												value={line.label}
												onChange={e =>
													handleManualPriceLineChange(
														line.local_id,
														'label',
														e.target.value,
													)
												}
												placeholder='Название'
											/>

											<input
												className='request-modal-input'
												type='number'
												min='1'
												value={line.quantity}
												onChange={e =>
													handleManualPriceLineChange(
														line.local_id,
														'quantity',
														e.target.value,
													)
												}
												placeholder='Кол-во'
											/>

											<input
												className='request-modal-input'
												type='number'
												min='0'
												value={line.unit_price}
												onChange={e =>
													handleManualPriceLineChange(
														line.local_id,
														'unit_price',
														e.target.value,
													)
												}
												placeholder='Цена'
											/>

											<button
												type='button'
												className='request-manual-line-remove'
												onClick={() => removeManualPriceLine(line.local_id)}
											>
												×
											</button>
										</div>
									))}

									<button
										type='button'
										className='request-add-manual-line-btn'
										onClick={addManualPriceLine}
									>
										+ Строка
									</button>
								</div>

								<div className='request-price-total'>
									<span>Итого</span>
									<strong>
										{formatMoney(displayedPriceCalculation.total_price)}
									</strong>
								</div>

								<div className='request-price-note'>
									Расчёт будет сохранён вместе с заявкой.
								</div>
							</aside>
						)}
					</div>
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
						disabled={loading || clientRequestBlocked}
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
