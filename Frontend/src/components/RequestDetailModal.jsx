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

const getClientPaymentTypeLabel = paymentType => {
	if (paymentType === 'POSTPAYMENT') return 'Постоплата'
	return 'Предоплата'
}

const getRequestPaymentText = request => {
	const paymentType = request?.client_payment_type || 'PREPAYMENT'
	const isPaid = Boolean(request?.is_paid)

	if (paymentType === 'POSTPAYMENT') {
		return isPaid ? 'Постоплата · оплачено' : 'Постоплата · не оплачено'
	}

	return isPaid ? 'Предоплата · оплачено' : 'Предоплата · не оплачено'
}

const getPriceSourceLabel = source => {
	if (source === 'client_override') return 'инд. цена'
	if (source === 'manual') return 'ручная'
	if (source === 'extra_sensor') return 'датчик'
	return ''
}

const getVisitPriceCodeLabel = code => {
	if (code === 'ON_SITE_OUTSIDE_CITY') return 'За пределами города'
	if (code === 'BUSINESS_TRIP_KM') return 'Командировка'
	return 'В черте города'
}

const scheduleApprovalLabels = {
	NOT_REQUIRED: 'Согласование не требуется',
	PENDING: 'Ожидает согласования времени',
	APPROVED: 'Время согласовано',
	REJECTED: 'Время отклонено',
}

const scheduleApprovalClasses = {
	NOT_REQUIRED: 'not-required',
	PENDING: 'pending',
	APPROVED: 'approved',
	REJECTED: 'rejected',
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
	const [techniciansLookup, setTechniciansLookup] = useState([])
	const [selectedExecutors, setSelectedExecutors] = useState([])
	const [techSearchTerm, setTechSearchTerm] = useState('')
	const [isTechDropdownOpen, setTechDropdownOpen] = useState(false)
	const techSearchRef = useRef(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [scheduleApprovalComment, setScheduleApprovalComment] = useState('')
	const [scheduleApprovalLoading, setScheduleApprovalLoading] = useState(false)

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

	const isRemovalRequest = request?.work_type === 'REMOVAL'

	const canDecideScheduleApproval = ['ADMIN'].includes(userRole)

	const isScheduleApprovalPending =
		request?.schedule_approval_status === 'PENDING'

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
			fetchTechniciansLookup()
		}
	}, [isOpen, requestId, initialTab, userRole])

	useEffect(() => {
		if (request) {
			const executorIds =
				request.executors && request.executors.length > 0
					? request.executors.map(executor => String(executor.user_id))
					: request.assigned_to
						? [String(request.assigned_to)]
						: []

			setSelectedExecutors(executorIds)
			setTechSearchTerm('')
		}
	}, [request])

	useEffect(() => {
		const handleClickOutside = e => {
			if (techSearchRef.current && !techSearchRef.current.contains(e.target)) {
				setTechDropdownOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	useEffect(() => {
		if (
			activeTab === 'equipment' &&
			(userRole === 'TECH_SUPPORT' || isRemovalRequest)
		) {
			setActiveTab('info')
		}
	}, [userRole, activeTab, isRemovalRequest])

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

	const fetchTechniciansLookup = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/technicians/lookup`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) setTechniciansLookup(await res.json())
		} catch (err) {
			console.error(err)
		}
	}

	const handleStatusChange = async e => {
		const newStatus = e.target.value

		try {
			let res

			if (newStatus === 'COMPLETED') {
				res = await fetch(`${API_BASE_URL}/requests/${requestId}/complete`, {
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
				})
			} else {
				res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({ status: newStatus }),
				})
			}

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
			const executorIds = selectedExecutors.map(id => parseInt(id, 10))

			const res = await fetch(
				`${API_BASE_URL}/requests/${requestId}/executors/assign`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({ executor_ids: executorIds }),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Ошибка при назначении/снятии исполнителей',
				)
			}

			if (executorIds.length === 0) {
				alert('Исполнители сняты с заявки!')
			} else {
				alert('Исполнители назначены!')
			}

			fetchRequestDetails()
			onUpdated()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleScheduleApprovalDecision = async decision => {
		if (!requestId) return

		const isRejected = decision === 'REJECTED'

		if (
			isRejected &&
			!window.confirm(
				'Отклонить согласование времени? Заявка автоматически перейдет в статус "Отменено".',
			)
		) {
			return
		}

		try {
			setScheduleApprovalLoading(true)

			const res = await fetch(
				`${API_BASE_URL}/requests/${requestId}/schedule-approval`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						status: decision,
						comment: scheduleApprovalComment.trim() || null,
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить согласование')
			}

			setScheduleApprovalComment('')
			await fetchRequestDetails()
			onUpdated()

			alert(
				decision === 'APPROVED'
					? 'Время выполнения согласовано'
					: 'Время выполнения отклонено, заявка отменена',
			)
		} catch (err) {
			alert(err.message)
		} finally {
			setScheduleApprovalLoading(false)
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

		const tech = techniciansLookup.find(t => t.id === id)
		return tech ? tech.name : `Сотрудник ID: ${id}`
	}

	const getSelectedExecutorNames = () => {
		if (!selectedExecutors.length) return 'Не назначены'

		return selectedExecutors.map(id => getTechName(id)).join(', ')
	}

	const toggleExecutor = techId => {
		const id = String(techId)

		setSelectedExecutors(prev => {
			if (prev.includes(id)) {
				return prev.filter(item => item !== id)
			}

			return [...prev, id]
		})
	}

	const removeExecutor = techId => {
		const id = String(techId)

		setSelectedExecutors(prev => prev.filter(item => item !== id))
	}

	const renderHistoryMessage = h => {
		const extractId = str => {
			if (!str) return null
			const match = String(str).match(/assigned_to=(\d+)/)
			if (match) return parseInt(match[1], 10)
			const num = parseInt(str, 10)
			return isNaN(num) ? null : num
		}

		if (h.action === 'CREATED') return 'Заявка создана'

		if (h.action === 'SCHEDULE_APPROVAL_REQUESTED') {
			return `Запрошено согласование нерабочего времени: ${h.new_value || 'причина не указана'}`
		}

		if (h.action === 'SCHEDULE_APPROVAL_DECIDED') {
			const value = String(h.new_value || '')

			if (value.startsWith('APPROVED')) {
				return `Нерабочее время согласовано${value.replace('APPROVED:', '').trim() ? `: ${value.replace('APPROVED:', '').trim()}` : ''}`
			}

			if (value.startsWith('REJECTED')) {
				return `Нерабочее время отклонено${value.replace('REJECTED:', '').trim() ? `: ${value.replace('REJECTED:', '').trim()}` : ''}`
			}

			return 'Решение по согласованию времени обновлено'
		}

		if (h.action === 'SCHEDULED_AT_CHANGED') {
			return `Желаемая дата выполнения изменена: ${formatDate(h.old_value)} → ${formatDate(h.new_value)}`
		}

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

		if (h.action === 'EXECUTORS_ASSIGNED') {
			return 'Исполнители заявки обновлены'
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

				if (h.action === 'REMOVAL_EQUIPMENT_DETACHED') {
					const oldValue = String(h.old_value || '').trim()
					const newValue = String(h.new_value || '').trim()

					let equipmentText = oldValue
					let resultText = newValue

					// old_value сейчас приходит примерно так:
					// "Teltonika FMC920 (IMEI: 123...), status=INSTALLED, condition=NEW"
					equipmentText = equipmentText
						.replace(/,\s*status=[^,]+/i, '')
						.replace(/,\s*condition=[^,]+/i, '')
						.trim()

					// new_value сейчас приходит примерно так:
					// "Снято с авто и возвращено на склад как БУ. Авто: Toyota Camry VIN: ..."
					if (resultText.startsWith('Снято с авто')) {
						resultText = resultText.replace(
							'Снято с авто и возвращено на склад как БУ.',
							'возвращено на склад как БУ.',
						)
					}

					if (equipmentText && resultText) {
						return `Снято оборудование: ${equipmentText} — ${resultText}`
					}

					return 'Оборудование снято с авто и возвращено на склад как БУ'
				}

				if (h.action === 'REMOVAL_COMPLETED_EQUIPMENT_RESULT') {
					return (
						h.new_value ||
						'Снятие завершено: оборудование возвращено на склад как БУ'
					)
				}

				if (h.action === 'REMOVAL_COMPLETED_MARKED_USED') {
					return h.new_value || 'Оборудование помечено как БУ после снятия'
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
					{userRole !== 'TECH_SUPPORT' && !isRemovalRequest && (
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
												<>
													<div className='info-row'>
														<span className='info-key'>Тип выезда</span>
														<span className='info-val'>
															{getVisitPriceCodeLabel(request.visit_price_code)}
														</span>
													</div>
													<div className='info-row'>
														<span className='info-key'>Адрес выезда</span>
														<span
															className='info-val'
															style={{ color: '#c62828', fontWeight: 'bold' }}
														>
															{request.address || '—'}
														</span>
													</div>
												</>
											)}

											<div className='info-row'>
												<span className='info-key'>Дата создания:</span>
												<span className='info-val'>
													{formatDate(request.created_at)}
												</span>
											</div>

											<div className='info-row'>
												<span className='info-key bold'>
													Желаемая дата выполнения:
												</span>
												<span className='info-val bold'>
													{formatDate(request.scheduled_at)}
												</span>
											</div>

											{request.schedule_approval_status &&
												request.schedule_approval_status !== 'NOT_REQUIRED' && (
													<div className='schedule-approval-detail-box'>
														<div className='schedule-approval-detail-header'>
															<span
																className={`schedule-approval-badge ${
																	scheduleApprovalClasses[
																		request.schedule_approval_status
																	] || 'pending'
																}`}
															>
																{scheduleApprovalLabels[
																	request.schedule_approval_status
																] || request.schedule_approval_status}
															</span>
														</div>

														{request.schedule_approval_reason && (
															<div className='schedule-approval-detail-row'>
																<span className='schedule-approval-detail-key'>
																	Причина менеджера:
																</span>
																<span className='schedule-approval-detail-value'>
																	{request.schedule_approval_reason}
																</span>
															</div>
														)}

														{request.schedule_approval_requested_at && (
															<div className='schedule-approval-detail-row'>
																<span className='schedule-approval-detail-key'>
																	Запрошено:
																</span>
																<span className='schedule-approval-detail-value'>
																	{formatDate(
																		request.schedule_approval_requested_at,
																	)}
																</span>
															</div>
														)}

														{request.schedule_approval_comment && (
															<div className='schedule-approval-detail-row'>
																<span className='schedule-approval-detail-key'>
																	Комментарий администрации:
																</span>
																<span className='schedule-approval-detail-value'>
																	{request.schedule_approval_comment}
																</span>
															</div>
														)}

														{canDecideScheduleApproval &&
															isScheduleApprovalPending && (
																<div className='schedule-approval-actions'>
																	<label className='schedule-approval-comment-field'>
																		<span>Комментарий администрации</span>
																		<textarea
																			value={scheduleApprovalComment}
																			onChange={e =>
																				setScheduleApprovalComment(
																					e.target.value,
																				)
																			}
																			placeholder='Можно указать причину согласования или отказа...'
																			rows={3}
																		/>
																	</label>

																	<div className='schedule-approval-buttons'>
																		<button
																			type='button'
																			className='schedule-approval-btn approve'
																			disabled={scheduleApprovalLoading}
																			onClick={() =>
																				handleScheduleApprovalDecision(
																					'APPROVED',
																				)
																			}
																		>
																			Согласовать
																		</button>

																		<button
																			type='button'
																			className='schedule-approval-btn reject'
																			disabled={scheduleApprovalLoading}
																			onClick={() =>
																				handleScheduleApprovalDecision(
																					'REJECTED',
																				)
																			}
																		>
																			Отклонить
																		</button>
																	</div>
																</div>
															)}
													</div>
												)}

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

								{activeTab === 'equipment' &&
									userRole !== 'TECH_SUPPORT' &&
									!isRemovalRequest && (
										<div className='tab-content'>
											<RequestEquipmentPanel
												requestId={requestId}
												vehicles={request.vehicles || []}
												requestCity={request.city || ''}
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
											<div className='payment-type-hint'>
												{getRequestPaymentText(request)}
											</div>
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
							request.status !== 'CANCELLED' &&
							!['PENDING', 'REJECTED'].includes(
								request.schedule_approval_status,
							) ? (
								<div className='footer-group request-executors-footer'>
									<span style={{ fontSize: '13px' }}>Исполнители:</span>

									<div className='request-executors-control'>
										<div className='request-executors-selected'>
											{selectedExecutors.length === 0 ? (
												<span className='request-executors-empty'>
													Не назначены
												</span>
											) : (
												selectedExecutors.map(executorId => (
													<span
														key={executorId}
														className='request-executor-chip'
													>
														{getTechName(executorId)}
														<button
															type='button'
															className='request-executor-chip-remove'
															onClick={() => removeExecutor(executorId)}
															title='Убрать исполнителя'
														>
															×
														</button>
													</span>
												))
											)}
										</div>

										<div className='footer-tech-search' ref={techSearchRef}>
											<button
												type='button'
												className='request-executor-add-btn'
												onClick={() => setTechDropdownOpen(prev => !prev)}
												title='Добавить исполнителя'
											>
												+
											</button>

											{isTechDropdownOpen && (
												<div className='footer-tech-dropdown request-executors-dropdown'>
													<input
														className='footer-select footer-tech-input request-executors-search'
														type='text'
														placeholder='Поиск исполнителя...'
														value={techSearchTerm}
														onChange={e => setTechSearchTerm(e.target.value)}
														autoFocus
													/>

													{filteredTechnicians.length === 0 ? (
														<div className='footer-tech-option footer-tech-option-empty'>
															Не найдено
														</div>
													) : (
														filteredTechnicians.map(t => {
															const isSelected = selectedExecutors.includes(
																String(t.id),
															)

															return (
																<div
																	key={t.id}
																	className={`footer-tech-option ${
																		isSelected ? 'active' : ''
																	}`}
																	onClick={() => toggleExecutor(t.id)}
																>
																	<span>{t.name}</span>
																	{isSelected && <span>✓</span>}
																</div>
															)
														})
													)}
												</div>
											)}
										</div>
									</div>

									<button
										className='btn-green'
										style={{ padding: '5px 12px', fontSize: '13px' }}
										onClick={handleAssign}
									>
										{selectedExecutors.length > 0 ? 'Назначить' : 'Снять'}
									</button>
								</div>
							) : ['PENDING', 'REJECTED'].includes(
									request.schedule_approval_status,
							  ) ? (
								<div className='footer-group'>
									<span className='schedule-approval-footer-warning'>
										{request.schedule_approval_status === 'PENDING'
											? 'Монтажника можно назначить после согласования времени'
											: 'Назначение недоступно: время отклонено'}
									</span>
								</div>
							) : request.executors && request.executors.length > 0 ? (
								<div className='footer-group'>
									<span
										style={{
											color: '#5e9424',
											fontWeight: '500',
											fontSize: '13px',
										}}
									>
										Исполнители:{' '}
										{request.executors
											.map(
												executor =>
													executor.user_name || getTechName(executor.user_id),
											)
											.join(', ')}
									</span>
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
										Исполнитель: {getTechName(request.assigned_to)}
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
