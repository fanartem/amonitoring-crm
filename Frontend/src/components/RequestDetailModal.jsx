import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Requests.css'

import RequestEquipmentPanel from './RequestEquipmentPanel'
import AttachmentsPanel from './AttachmentsPanel'
import { getWorkTypeLabel } from '../utils/workTypes'

const getUserRole = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null
		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(function (c) {
					return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
				})
				.join(''),
		)
		return JSON.parse(jsonPayload).role
	} catch (error) {
		return null
	}
}

const mapTypeToUI = dbType => {
	if (!dbType) return 'Физ. лицо'
	const t = String(dbType).toUpperCase()
	if (t === 'TOO' || t === 'ТОО') return 'ТОО'
	if (t === 'IP' || t === 'ИП') return 'ИП'
	return 'Физ. лицо'
}

const vehicleTypeLabels = {
	car: 'Легковая',
	electric: 'Электромобиль',
	special: 'Спецтехника',
}

const formatVehicleType = type => {
	if (!type) return '—'
	return vehicleTypeLabels[type] || type
}

const formatMoney = value => {
	if (value === null || value === undefined || value === '') return '0 тг'

	const number = Number(value)

	if (Number.isNaN(number)) return `${value} тг`

	return `${number.toLocaleString('ru-RU')} тг`
}

const getPriceSourceLabel = source => {
	if (source === 'client_override') return 'инд. цена'
	if (source === 'manual') return 'ручная'
	if (source === 'extra_sensor') return 'датчик'
	return ''
}

export default function RequestDetailModal({
	isOpen,
	onClose,
	requestId,
	onUpdated,
	initialTab = 'info',
	onEditClick,
}) {
	const [activeTab, setActiveTab] = useState(initialTab)
	const [request, setRequest] = useState(null)
	const [comments, setComments] = useState([])
	const [history, setHistory] = useState([])
	const [newComment, setNewComment] = useState('')
	const [technicians, setTechnicians] = useState([])
	const [selectedTech, setSelectedTech] = useState('')
	const [techSearchTerm, setTechSearchTerm] = useState('')
	const [isTechDropdownOpen, setTechDropdownOpen] = useState(false)
	const techSearchRef = useRef(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const userRole = getUserRole()

	const canViewRequestPrice =
		userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN'

	const canPayRequest = ['ADMIN', 'ROP', 'ACCOUNTANT'].includes(userRole)

	const canAssignTechnician = ['ADMIN', 'ROP', 'SENIOR_TECHNICIAN'].includes(
		userRole,
	)

	const canDeleteRequest =
		Boolean(request?.can_delete) ||
		Boolean(request?.can_delete_own_with_time_limit)

	const canEditRequest = Boolean(request?.can_edit)

	const canChangeRequestStatus = Boolean(request?.can_change_status)

	const canManageEquipment = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(userRole)

	const filteredTechnicians = techSearchTerm.trim()
		? technicians.filter(t =>
				t.name.toLowerCase().includes(techSearchTerm.trim().toLowerCase()),
			)
		: technicians

	useEffect(() => {
		const handleKeyDown = e => {
			if (e.key === 'Escape') onClose()
		}
		if (isOpen) window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [isOpen, onClose])

	useEffect(() => {
		if (isOpen && requestId) {
			setActiveTab(initialTab)
			fetchRequestDetails()
			fetchComments()
			fetchTechnicians()
		}
	}, [isOpen, requestId, initialTab, userRole])

	useEffect(() => {
		if (request) {
			setSelectedTech(request.assigned_to ? request.assigned_to.toString() : '')
			setTechSearchTerm(
				request.assigned_to ? getTechName(request.assigned_to) : '',
			)
		}
	}, [request, technicians])

	useEffect(() => {
		const handleClickOutside = e => {
			if (
				techSearchRef.current &&
				!techSearchRef.current.contains(e.target)
			) {
				setTechDropdownOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	useEffect(() => {
		if (userRole === 'TECH_SUPPORT' && activeTab === 'equipment') {
			setActiveTab('info')
		}
	}, [userRole, activeTab])

	const fetchRequestDetails = async () => {
		setLoading(true)
		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				headers: getAuthHeaders(),
			})
			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить данные заявки')
			}

			const data = await res.json()
			setRequest(data.request)
			setHistory(data.history || [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchComments = async () => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/requests/${requestId}/comments`,
				{
					headers: getAuthHeaders(),
				},
			)
			if (res.ok) {
				const data = await res.json()
				setComments(data)
			}
		} catch (err) {
			console.error(err)
		}
	}

	const fetchTechnicians = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/technicians`, {
				headers: getAuthHeaders(),
			})
			if (res.ok) {
				const data = await res.json()
				setTechnicians(data)
			}
		} catch (err) {
			console.error(err)
		}
	}

	const handleStatusChange = async e => {
		const newStatus = e.target.value
		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ status: newStatus }),
			})
			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить статус')
			}
			setRequest({ ...request, status: newStatus })
			fetchRequestDetails()
			onUpdated()
		} catch (err) {
			alert(err.message)
		}
	}

	const handlePaymentChange = async e => {
		const newIsPaid = e.target.value === 'true'
		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ is_paid: newIsPaid }),
			})
			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить статус оплаты')
			}
			setRequest({ ...request, is_paid: newIsPaid })
			fetchRequestDetails()
			onUpdated()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleAddComment = async () => {
		if (!newComment.trim()) return
		try {
			const res = await fetch(`${API_BASE_URL}/requests/comments`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ request_id: requestId, message: newComment }),
			})
			if (!res.ok) throw new Error('Не удалось отправить комментарий')
			setNewComment('')
			fetchComments()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleAssign = async () => {
		try {
			const techId = selectedTech ? parseInt(selectedTech, 10) : null

			const res = await fetch(`${API_BASE_URL}/requests/${requestId}/assign`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ technician_id: techId }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Ошибка при назначении/снятии сотрудника',
				)
			}

			if (!techId) alert('Монтажник успешно снят с заявки!')
			else
				alert(
					request.assigned_to
						? 'Монтажник успешно заменен!'
						: 'Монтажник назначен!',
				)

			fetchRequestDetails()
			onUpdated()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleDeleteRequest = async () => {
		if (
			!window.confirm(
				'Вы уверены, что хотите удалить эту заявку? Она будет перемещена в Корзину.',
			)
		)
			return

		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})
			if (!res.ok) {
				const errData = await res.json().catch(() => null)
				throw new Error(errData?.detail || 'Ошибка при удалении заявки')
			}
			alert('Заявка удалена!')
			onUpdated()
			onClose()
		} catch (err) {
			alert(err.message)
		}
	}

	const getTechName = val => {
		const strVal = String(val)
		if (
			!val ||
			strVal === 'null' ||
			strVal === 'None' ||
			strVal.includes('NaN')
		)
			return 'Не назначен'

		const id = parseInt(strVal, 10)
		if (isNaN(id)) return strVal

		const tech = technicians.find(t => t.id === id)
		return tech ? tech.name : `Сотрудник ID: ${id}`
	}

	// === НОВЫЙ УМНЫЙ ПЕРЕВОДЧИК ИСТОРИИ ===
	const renderHistoryMessage = h => {
		const extractId = str => {
			if (!str) return null
			const match = String(str).match(/assigned_to=(\d+)/)
			if (match) return parseInt(match[1], 10)
			const num = parseInt(str, 10)
			return isNaN(num) ? null : num
		}

		if (h.action === 'CREATED') return 'Заявка создана'

		if (h.action === 'SELF_ACCEPTED') return 'Заявка принята в работу'

		if (h.action === 'STATUS_CHANGED') {
			const statusMap = {
				NEW: 'В ожидании',
				IN_PROGRESS: 'В процессе',
				COMPLETED: 'Завершено',
				CANCELLED: 'Отменено',
			}
			return `Статус изменен: ${statusMap[h.old_value] || h.old_value} → ${statusMap[h.new_value] || h.new_value}`
		}

		if (h.action === 'PAYMENT_CHANGED' || h.action === 'PAYMENT_UPDATED') {
			const isPaid = String(h.new_value).toLowerCase().includes('true')
			return `Статус оплаты: ${isPaid ? 'Оплачено' : 'Ожидает оплаты'}`
		}

		if (
			h.action === 'ASSIGNED' ||
			h.action === 'TECHNICIAN_ASSIGNED' ||
			h.action === 'TECHNICIAN_CHANGED'
		) {
			const oldId = extractId(h.old_value)
			const newId = extractId(h.new_value)
			if (oldId && oldId !== newId) {
				return `Монтажник изменен: ${getTechName(oldId)} → ${getTechName(newId)}`
			}
			return `Назначен монтажник: ${getTechName(newId)}`
		}

		if (h.action === 'UNASSIGNED') {
			const oldId = extractId(h.old_value)
			return `Монтажник снят: ${getTechName(oldId)}`
		}

		if (h.action === 'EQUIPMENT_ATTACHED') {
			const raw = h.new_value || ''
			const vehicleMatch = raw.match(/,\s*vehicle=(.+)$/)
			const vehicle = vehicleMatch ? vehicleMatch[1].trim() : null
			const eq = raw
				.replace(/,\s*vehicle=.+$/, '')
				.replace(/, quantity=\d+/, '')
				.trim()
			if (vehicle) {
				return `Устройство привязано на ${vehicle}: ${eq}`
			}
			return `Привязано оборудование: ${eq}`
		}

		if (h.action === 'EQUIPMENT_DETACHED') {
			const raw = h.old_value || ''
			const vehicleMatch = raw.match(/,\s*vehicle=(.+)$/)
			const vehicle = vehicleMatch ? vehicleMatch[1].trim() : null
			const eq = raw
				.replace(/,\s*vehicle=.+$/, '')
				.replace(/, quantity=\d+/, '')
				.trim()
			if (vehicle) {
				return `Устройство отвязано от ${vehicle}: ${eq}`
			}
			return `Отвязано оборудование: ${eq}`
		}

		if (h.action === 'CLIENT_CHANGED') return 'Изменен клиент заявки'
		if (h.action === 'VEHICLE_CHANGED') return 'Изменен автомобиль заявки'
		if (h.action === 'CITY_CHANGED') return `Город изменен: ${h.new_value}`
		if (h.action === 'ADDRESS_CHANGED') return `Адрес изменен: ${h.new_value}`

		if (h.action === 'PLATFORM_CHANGED') {
			return (
				<span>
					Платформа мониторинга изменена:{' '}
					<span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>
						{h.old_value || '—'}
					</span>
					{' → '}
					<span style={{ fontWeight: '600', color: '#1b1b1d' }}>
						{h.new_value || '—'}
					</span>
				</span>
			)
		}

		return h.action
	}

	if (!isOpen) return null

	const formatDate = dateString => {
		if (!dateString) return '—'
		const d = new Date(dateString)
		return (
			d.toLocaleDateString('ru-RU') +
			' ' +
			d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
		)
	}

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div className='custom-detail-window' onClick={e => e.stopPropagation()}>
				<div className='modal-header'>
					<span className='modal-title'>
						Заявка — {request ? request.client_name : 'Загрузка...'}
					</span>
					<button className='modal-close' onClick={onClose}>
						&times;
					</button>
				</div>

				<div className='custom-tabs'>
					<button
						className={`custom-tab ${activeTab === 'info' ? 'active' : ''}`}
						onClick={() => setActiveTab('info')}
					>
						Информация
					</button>
					<button
						className={`custom-tab ${activeTab === 'files' ? 'active' : ''}`}
						onClick={() => setActiveTab('files')}
					>
						Файлы
					</button>
					<button
						className={`custom-tab ${activeTab === 'comments' ? 'active' : ''}`}
						onClick={() => setActiveTab('comments')}
					>
						Комментарии <span className='tab-badge'>{comments.length}</span>
					</button>
					<button
						className={`custom-tab ${activeTab === 'history' ? 'active' : ''}`}
						onClick={() => setActiveTab('history')}
					>
						История
					</button>
					{userRole !== 'TECH_SUPPORT' && (
						<button
							className={`custom-tab ${activeTab === 'equipment' ? 'active' : ''}`}
							onClick={() => setActiveTab('equipment')}
						>
							Оборудование
						</button>
					)}
				</div>

				<div className='custom-body'>
					{loading ? (
						<div className='loading-state'>Загрузка данных...</div>
					) : error ? (
						<div className='validation-banner visible'>{error}</div>
					) : (
						request && (
							<>
								{activeTab === 'info' && (
									<div className='tab-content'>
										{canEditRequest && onEditClick && (
											<div
												style={{
													display: 'flex',
													justifyContent: 'flex-end',
													marginBottom: '15px',
												}}
											>
												<button
													className='btn-edit-request'
													onClick={() => onEditClick(request)}
												>
													✎ Изменить заявку
												</button>
											</div>
										)}

										<div className='info-card'>
											<div className='info-card-title'>Клиент</div>
											<div className='info-row'>
												<span className='info-key'>Тип лица</span>
												<span
													className='info-val'
													style={{ color: '#5e9424', fontWeight: 'bold' }}
												>
													{mapTypeToUI(
														request.client_type ||
															request.type ||
															request.client?.type,
													)}
												</span>
											</div>
											{['TOO', 'IP', 'ТОО', 'ИП'].includes(
												String(
													request.client_type ||
														request.type ||
														request.client?.type,
												).toUpperCase(),
											) && (
												<div className='info-row'>
													<span className='info-key'>Наименование</span>
													<span className='info-val'>
														{request.company_name ||
															request.client?.company_name ||
															'—'}
													</span>
												</div>
											)}
											<div className='info-row'>
												<span className='info-key'>ФИО</span>
												<span className='info-val'>
													{request.client_name || request.client?.name || '—'}
												</span>
											</div>
											<div className='info-row'>
												<span className='info-key'>Телефон</span>
												<span className='info-val'>
													{request.phone || request.client?.phone || '—'}
												</span>
											</div>
											<div className='info-row'>
												<span className='info-key'>Email</span>
												<span className='info-val'>
													{request.email || request.client?.email || '—'}
												</span>
											</div>
											{request.client_status && (
												<div className='info-row'>
													<span className='info-key'>Статус клиента</span>
													<span
														className={`info-val client-status-detail client-status-${String(request.client_status).toLowerCase()}`}
													>
														{request.client_status === 'ACTIVE'
															? 'Активный'
															: request.client_status === 'DEBTOR'
																? 'Должник'
																: request.client_status === 'BLOCKED'
																	? 'Заблокированный'
																	: request.client_status}
													</span>
												</div>
											)}
											{request.responsible_manager_name && (
												<div className='info-row'>
													<span className='info-key'>
														Ответственный за клиента
													</span>
													<span className='info-val'>
														{request.responsible_manager_name}
													</span>
												</div>
											)}
										</div>

										<div className='info-card'>
											<div className='info-card-title'>
												Транспорт ({request.vehicles?.length || 0})
											</div>

											{!request.vehicles || request.vehicles.length === 0 ? (
												<div
													className='empty-state'
													style={{ padding: '15px 0' }}
												>
													Автомобили не указаны
												</div>
											) : (
												<div className='request-vehicles-list'>
													{request.vehicles.map((vehicle, index) => (
														<div
															key={
																vehicle.request_vehicle_id ||
																vehicle.vehicle_id ||
																index
															}
															className='request-vehicle-card'
														>
															<div className='request-vehicle-header'>
																<div>
																	<div className='request-vehicle-title'>
																		{index + 1}. {vehicle.brand || '—'}{' '}
																		{vehicle.model || ''}
																	</div>

																	<div className='request-vehicle-subtitle'>
																		{vehicle.plate_number || 'б/н'} ·{' '}
																		{formatVehicleType(vehicle.vehicle_type)}
																	</div>
																</div>

																{request.work_type === 'INSTALLATION' && (
																	<div className='request-vehicle-install-badges'>
																		<span
																			className={`install-badge ${vehicle.has_blocking ? 'active' : ''}`}
																		>
																			{vehicle.has_blocking
																				? 'С блокировкой'
																				: 'Без блокировки'}
																		</span>

																		<span
																			className={`install-badge ${vehicle.has_beacon ? 'active' : ''}`}
																		>
																			{vehicle.has_beacon
																				? 'С маяком'
																				: 'Без маяка'}
																		</span>
																	</div>
																)}
															</div>

															<div className='request-vehicle-grid'>
																<div className='info-row'>
																	<span className='info-key'>Год выпуска</span>
																	<span className='info-val'>
																		{vehicle.year || '—'}
																	</span>
																</div>

																<div className='info-row vin-value'>
																	<span className='info-key'>VIN-код</span>
																	<span className='info-val'>
																		{vehicle.vin || '—'}
																	</span>
																</div>
															</div>

															{request.work_type === 'INSTALLATION' && (
																<div className='request-extra-sensors-detail'>
																	<div className='request-extra-sensors-detail-title'>
																		Дополнительные датчики
																	</div>

																	{vehicle.extra_sensors &&
																	vehicle.extra_sensors.length > 0 ? (
																		<div className='request-extra-sensors-detail-list'>
																			{vehicle.extra_sensors.map(sensor => (
																				<div
																					key={sensor.id}
																					className='request-extra-sensor-detail-row'
																				>
																					<span className='request-extra-sensor-name'>
																						{sensor.name || 'Датчик'}
																					</span>

																					{canViewRequestPrice && (
																						<span className='request-extra-sensor-price'>
																							{formatMoney(sensor.price)}
																						</span>
																					)}
																				</div>
																			))}
																		</div>
																	) : (
																		<div className='request-extra-sensors-detail-empty'>
																			Дополнительные датчики не добавлены
																		</div>
																	)}
																</div>
															)}
														</div>
													))}
												</div>
											)}
										</div>

										<div className='info-card'>
											<div className='info-card-title'>Работы</div>
											<div className='info-row'>
												<span className='info-key'>Город</span>
												<span className='info-val'>
													{request.city || 'Не указан'}
												</span>
											</div>
											<div className='info-row'>
												<span className='info-key'>Форма работы</span>
												<span className='info-val'>
													{getWorkTypeLabel(request.work_type)}
												</span>
											</div>
											<div className='info-row'>
												<span className='info-key'>Формат</span>
												<span className='info-val'>
													{request.visit_type === 'ON_SITE'
														? 'Выезд к клиенту'
														: 'В офисе'}
												</span>
											</div>

											{request.visit_type === 'ON_SITE' && (
												<div className='info-row'>
													<span className='info-key'>Адрес выезда</span>
													<span
														className='info-val'
														style={{ color: '#c62828', fontWeight: 'bold' }}
													>
														{request.address || '—'}
													</span>
												</div>
											)}

											<div className='info-row'>
												<span className='info-key'>Дата выполнения</span>
												<span className='info-val'>
													{formatDate(request.created_at).split(' ')[0]}
												</span>
											</div>

											{canViewRequestPrice && (
												<div className='info-row'>
													<span className='info-key'>Статус оплаты</span>
													<span
														className='info-val'
														style={{
															display: 'flex',
															flexDirection: 'row',
															gap: '10px',
															alignItems: 'center',
														}}
													>
														<span
															className={`status-badge ${Boolean(request.is_paid) ? 'status-progress' : 'status-new'}`}
															style={{
																padding: '2px 8px',
																fontSize: '11px',
																display: 'inline-block',
															}}
														>
															{Boolean(request.is_paid)
																? 'Оплачено'
																: 'Ожидает оплаты'}
														</span>
														{Boolean(request.is_paid) && request.paid_at && (
															<span style={{ fontSize: '12px', color: '#888' }}>
																(Дата: {formatDate(request.paid_at)})
															</span>
														)}
													</span>
												</div>
											)}
										</div>

										<div className='info-card'>
											<div className='info-card-title'>
												Платформа мониторинга
											</div>

											<div className='info-row'>
												<span className='info-key'>Платформа</span>
												<span
													className='info-val'
													style={{ fontWeight: '700', color: '#181717' }}
												>
													{request.platform || 'Не указана'}
												</span>
											</div>
										</div>

										{canViewRequestPrice && (
											<div className='info-card'>
												<div className='request-price-detail-header'>
													<div className='info-card-title'>
														Стоимость заявки
													</div>

													<div className='request-price-detail-total'>
														{formatMoney(request.total_price)}
													</div>
												</div>

												{request.price_lines &&
												request.price_lines.length > 0 ? (
													<div className='request-price-detail-list'>
														{request.price_lines.map((line, index) => {
															const sourceLabel = getPriceSourceLabel(
																line.source,
															)

															return (
																<div
																	key={line.id || line.line_key || index}
																	className='request-price-detail-row'
																>
																	<div className='request-price-detail-main'>
																		<div className='request-price-detail-label'>
																			{line.label || 'Строка расчёта'}
																		</div>

																		<div className='request-price-detail-meta'>
																			{Number(
																				line.quantity || 0,
																			).toLocaleString('ru-RU')}{' '}
																			{line.unit || 'шт'} ×{' '}
																			{formatMoney(line.unit_price)}
																			{sourceLabel && (
																				<span
																					className={`request-price-detail-source ${line.source}`}
																				>
																					{sourceLabel}
																				</span>
																			)}
																		</div>
																	</div>

																	<div className='request-price-detail-line-total'>
																		{formatMoney(line.total_price)}
																	</div>
																</div>
															)
														})}
													</div>
												) : (
													<div className='request-price-detail-empty'>
														Детализация стоимости не сохранена
													</div>
												)}
											</div>
										)}
									</div>
								)}

								{activeTab === 'files' && (
									<div className='tab-content'>
										<AttachmentsPanel
											entityType='REQUEST'
											entityId={requestId}
										/>
									</div>
								)}

								{activeTab === 'comments' && (
									<div className='tab-content flex-col'>
										<div className='comments-area'>
											{comments.length === 0 ? (
												<div className='empty-state'>Нет комментариев</div>
											) : (
												comments.map((c, i) => (
													<div key={i} className='comment-bubble'>
														<strong>{c.author || 'Пользователь'}</strong>{' '}
														<span className='comment-date'>
															{formatDate(c.created_at)}
														</span>
														<p>{c.message}</p>
													</div>
												))
											)}
										</div>
										<div className='comment-input-area'>
											<textarea
												placeholder='Написать комментарий...'
												value={newComment}
												onChange={e => setNewComment(e.target.value)}
											></textarea>
											<button className='btn-green' onClick={handleAddComment}>
												Отправить
											</button>
										</div>
									</div>
								)}

								{activeTab === 'history' && (
									<div className='tab-content'>
										{history.length === 0 ? (
											<div className='empty-state'>История пуста</div>
										) : (
											<div className='history-timeline'>
												{history.map((h, i) => (
													<div key={i} className='history-item'>
														<div className='history-dot'></div>
														<div className='history-content'>
															<div className='history-action'>
																{renderHistoryMessage(h)}
															</div>
															<div className='history-meta'>
																{formatDate(h.created_at)}{' '}
																<span className='history-author'>
																	{h.user_name || 'Система'}
																</span>
															</div>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								)}

								{activeTab === 'equipment' && userRole !== 'TECH_SUPPORT' && (
									<div className='tab-content'>
										<RequestEquipmentPanel
											requestId={requestId}
											vehicles={request.vehicles || []}
										/>
									</div>
								)}
							</>
						)
					)}
				</div>

				{request && (
					<div
						className='custom-footer'
						style={{
							flexDirection: 'column',
							alignItems: 'stretch',
							gap: '15px',
						}}
					>
						<div
							style={{
								display: 'flex',
								gap: '20px',
								alignItems: 'center',
								flexWrap: 'wrap',
								justifyContent: 'space-between',
							}}
						>
							<div
								style={{
									display: 'flex',
									gap: '20px',
									alignItems: 'center',
									flexWrap: 'wrap',
								}}
							>
								{canChangeRequestStatus ? (
									<div className='footer-group'>
										<span style={{ fontSize: '13px' }}>Статус:</span>
										<select
											className='footer-select'
											style={{ padding: '4px 8px', fontSize: '13px' }}
											value={request.status || 'NEW'}
											onChange={handleStatusChange}
										>
											<option value='NEW'>В ожидании</option>
											<option value='IN_PROGRESS'>Принято в работу</option>
											<option value='COMPLETED'>Работы завершены</option>
											<option value='CANCELLED'>Отмена заявки</option>
										</select>
									</div>
								) : (
									<div className='footer-group'>
										<span style={{ fontSize: '13px' }}>
											Статус:{' '}
											<strong>
												{request.status === 'NEW'
													? 'В ожидании'
													: request.status === 'IN_PROGRESS'
														? 'Принято в работу'
														: request.status === 'COMPLETED'
															? 'Завершено'
															: 'Отменено'}
											</strong>
										</span>
									</div>
								)}

								{canViewRequestPrice &&
									(canPayRequest ? (
										<div className='footer-group'>
											<span style={{ fontSize: '13px' }}>Оплата:</span>
											<select
												className='footer-select'
												style={{ padding: '4px 8px', fontSize: '13px' }}
												value={request.is_paid ? 'true' : 'false'}
												onChange={handlePaymentChange}
											>
												<option value='false'>Ожидает оплаты</option>
												<option value='true'>Оплачено</option>
											</select>
										</div>
									) : (
										<div className='footer-group'>
											<span style={{ fontSize: '13px' }}>
												Оплата:{' '}
												<strong>
													{Boolean(request.is_paid)
														? 'Оплачено'
														: 'Ожидает оплаты'}
												</strong>
											</span>
										</div>
									))}
							</div>

							{canDeleteRequest && (
								<button
									onClick={handleDeleteRequest}
									style={{
										background: 'transparent',
										border: '1px solid #ffcdd2',
										color: '#c62828',
										padding: '4px 12px',
										borderRadius: '6px',
										cursor: 'pointer',
										fontSize: '13px',
										fontWeight: '500',
									}}
								>
									Удалить заявку
								</button>
							)}
						</div>

						<div
							style={{
								display: 'flex',
								justifyContent: 'flex-start',
								width: '100%',
							}}
						>
							{canAssignTechnician &&
							request.status !== 'COMPLETED' &&
							request.status !== 'CANCELLED' ? (
								<div className='footer-group'>
									<span style={{ fontSize: '13px' }}>Монтажник:</span>

									<div className='footer-tech-search' ref={techSearchRef}>
										<input
											className='footer-select footer-tech-input'
											type='text'
											placeholder='Поиск...'
											value={techSearchTerm}
											onChange={e => {
												setTechSearchTerm(e.target.value)
												setTechDropdownOpen(true)
												if (selectedTech) setSelectedTech('')
											}}
											onFocus={() => setTechDropdownOpen(true)}
										/>

										{isTechDropdownOpen && (
											<div className='footer-tech-dropdown'>
												<div
													className={`footer-tech-option ${
														!selectedTech ? 'active' : ''
													}`}
													onClick={() => {
														setSelectedTech('')
														setTechSearchTerm('')
														setTechDropdownOpen(false)
													}}
												>
													— не назначен —
												</div>

												{filteredTechnicians.length === 0 ? (
													<div className='footer-tech-option footer-tech-option-empty'>
														Не найдено
													</div>
												) : (
													filteredTechnicians.map(t => (
														<div
															key={t.id}
															className={`footer-tech-option ${
																String(t.id) === String(selectedTech)
																	? 'active'
																	: ''
															}`}
															onClick={() => {
																setSelectedTech(String(t.id))
																setTechSearchTerm(t.name)
																setTechDropdownOpen(false)
															}}
														>
															{t.name}
														</div>
													))
												)}
											</div>
										)}
									</div>

									<button
										className='btn-green'
										style={{ padding: '5px 12px', fontSize: '13px' }}
										onClick={handleAssign}
									>
										{request.assigned_to
											? selectedTech
												? 'Изменить'
												: 'Снять'
											: 'Назначить'}
									</button>
								</div>
							) : request.assigned_to ? (
								<div className='footer-group'>
									<span
										style={{
											color: '#5e9424',
											fontWeight: '500',
											fontSize: '13px',
										}}
									>
										Монтажник: {getTechName(request.assigned_to)}
									</span>
								</div>
							) : null}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}