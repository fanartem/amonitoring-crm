import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import { getStoredUser, hasAnyPermission } from '../utils/access'
import { getWorkTypeColor, getWorkTypeLabel } from '../utils/workTypes'
import '../styles/Requests.css'
import '../styles/Clients.css'

const LEGACY_REQUEST_TRASH_ROLES = ['ADMIN', 'ROP']
const LEGACY_CLIENT_TRASH_ROLES = ['ADMIN']

const isLegacyRequestTrashRole = user =>
	LEGACY_REQUEST_TRASH_ROLES.includes(user?.role)

const isLegacyClientTrashRole = user =>
	LEGACY_CLIENT_TRASH_ROLES.includes(user?.role)

const canViewRequestTrash = user =>
	hasAnyPermission(user, [
		'trash.view',
		'trash.manage',
		'requests.restore',
		'requests.delete_any',
		'requests.manage',
	]) || isLegacyRequestTrashRole(user)

const canRestoreRequestTrash = user =>
	hasAnyPermission(user, [
		'trash.manage',
		'requests.restore',
		'requests.manage',
	]) || isLegacyRequestTrashRole(user)

const canViewClientTrash = user =>
	hasAnyPermission(user, [
		'trash.view',
		'trash.clients.view',
		'trash.manage',
		'clients.deleted.view',
		'clients.restore',
		'clients.manage',
	]) || isLegacyClientTrashRole(user)

const canRestoreClientTrash = user =>
	hasAnyPermission(user, [
		'trash.manage',
		'trash.clients.restore',
		'clients.restore',
		'clients.manage',
	]) || isLegacyClientTrashRole(user)

const STATUS_LABELS = {
	NEW: 'В ожидании',
	IN_PROGRESS: 'Принято в работу',
	COMPLETED: 'Работы завершены',
	CANCELLED: 'Отменено',
}

const STATUS_CLASSES = {
	NEW: 'status-new',
	IN_PROGRESS: 'status-progress',
	COMPLETED: 'status-done',
	CANCELLED: 'status-cancelled',
}

const CLIENT_TYPE_LABELS = {
	TOO: 'ТОО',
	IP: 'ИП',
	INDIVIDUAL: 'Физ. лицо',
}

const ROLE_LABELS = {
	ADMIN: 'Админ',
	ROP: 'РОП',
	MANAGER: 'Менеджер',
	TECH_SUPPORT: 'Тех. поддержка',
	SENIOR_TECHNICIAN: 'Старший',
	TECHNICIAN: 'Монтажник',
	ACCOUNTANT: 'Бухгалтер',
	WAREHOUSE_MANAGER: 'Зав. складом',
}

const ROLE_CLASSES = {
	ADMIN: 'role-admin',
	ROP: 'role-rop',
	MANAGER: 'role-manager',
	TECH_SUPPORT: 'role-support',
	SENIOR_TECHNICIAN: 'role-senior',
	TECHNICIAN: 'role-tech',
	ACCOUNTANT: 'role-accountant',
	WAREHOUSE_MANAGER: 'role-warehouse',
}

const SCHEDULE_APPROVAL_LABELS = {
	NOT_REQUIRED: 'Согласование не требуется',
	PENDING: 'Ожидает согласования времени',
	APPROVED: 'Время согласовано',
	REJECTED: 'Время отклонено',
}

const SCHEDULE_APPROVAL_CLASSES = {
	NOT_REQUIRED: 'not-required',
	PENDING: 'pending',
	APPROVED: 'approved',
	REJECTED: 'rejected',
}

const getRequestClientName = request => {
	if (request.client_type === 'TOO' || request.client_type === 'IP') {
		return request.company_name || request.client_name || 'Неизвестный клиент'
	}

	return request.client_name || request.company_name || 'Неизвестный клиент'
}

const getClientSubtitle = request => {
	const clientType = request.client_type || request.type

	if ((clientType === 'TOO' || clientType === 'IP') && request.client_name) {
		return `${CLIENT_TYPE_LABELS[clientType] || clientType} · ${request.client_name}`
	}

	if (clientType === 'INDIVIDUAL') return CLIENT_TYPE_LABELS[clientType]

	return null
}

const getVehicleTitle = (vehicle, index) => {
	const title =
		`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
		`Авто ${index + 1}`
	const plate = vehicle.plate_number || 'б/н'

	return `${title} (${plate})`
}

const getVehicleInstallText = vehicle =>
	`${vehicle.has_blocking ? 'С блокировкой' : 'Без блокировки'} • ${
		vehicle.has_beacon ? 'Маяк' : 'Без маяка'
	}`

const getVisitPriceCodeLabel = code => {
	if (code === 'ON_SITE_OUTSIDE_CITY') return 'За пределами города'
	if (code === 'BUSINESS_TRIP_KM') return 'Командировка'

	return 'В черте города'
}

const getErrorMessage = async response => {
	const raw = await response.text()
	if (!raw) return ''

	try {
		const data = JSON.parse(raw)

		if (typeof data?.detail === 'string') return data.detail

		if (Array.isArray(data?.detail)) {
			return data.detail
				.map(item => item.msg || item.detail || JSON.stringify(item))
				.join('\n')
		}

		return JSON.stringify(data)
	} catch {
		return raw
	}
}

export default function Trash() {
	const user = useMemo(() => getStoredUser(), [])

	const canViewRequests = canViewRequestTrash(user)
	const canRestoreRequests = canRestoreRequestTrash(user)
	const canViewClients = canViewClientTrash(user)
	const canRestoreClients = canRestoreClientTrash(user)
	const canViewTrash = canViewRequests || canViewClients

	const [activeTab, setActiveTab] = useState(
		canViewRequests ? 'requests' : 'clients',
	)
	const [deletedRequests, setDeletedRequests] = useState([])
	const [deletedClients, setDeletedClients] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [restoringRequestId, setRestoringRequestId] = useState(null)
	const [restoringClientId, setRestoringClientId] = useState(null)

	useEffect(() => {
		if (!canViewRequests && activeTab === 'requests' && canViewClients) {
			setActiveTab('clients')
		}

		if (!canViewClients && activeTab === 'clients' && canViewRequests) {
			setActiveTab('requests')
		}
	}, [activeTab, canViewRequests, canViewClients])

	useEffect(() => {
		if (!canViewTrash) return

		fetchTrashData()
	}, [canViewTrash]) // eslint-disable-line react-hooks/exhaustive-deps

	const fetchDeletedRequests = async headers => {
		if (!canViewRequests) return []

		const response = await fetch(`${API_BASE_URL}/requests/deleted`, {
			headers,
		})

		if (response.status === 403) return []

		if (!response.ok) {
			throw new Error(
				(await getErrorMessage(response)) ||
					'Не удалось загрузить удалённые заявки',
			)
		}

		const data = await response.json()
		return Array.isArray(data) ? data : []
	}

	const fetchDeletedClients = async headers => {
		if (!canViewClients) return []

		const response = await fetch(`${API_BASE_URL}/clients/deleted`, { headers })

		if (response.status === 403) return []

		if (!response.ok) {
			throw new Error(
				(await getErrorMessage(response)) ||
					'Не удалось загрузить удалённых клиентов',
			)
		}

		const data = await response.json()
		return Array.isArray(data) ? data : []
	}

	const fetchTrashData = async () => {
		if (!canViewTrash) return

		setLoading(true)
		setError('')

		try {
			const headers = getAuthHeaders()

			const [requestsData, clientsData] = await Promise.all([
				fetchDeletedRequests(headers),
				fetchDeletedClients(headers),
			])

			setDeletedRequests(requestsData)
			setDeletedClients(clientsData)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleRestoreRequest = async id => {
		if (!canRestoreRequests) {
			alert('Недостаточно прав для восстановления заявки')
			return
		}

		setRestoringRequestId(id)

		try {
			const res = await fetch(`${API_BASE_URL}/requests/${id}/restore`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				throw new Error(
					(await getErrorMessage(res)) || 'Ошибка при восстановлении заявки',
				)
			}

			setDeletedRequests(prev => prev.filter(request => request.id !== id))
			alert('Заявка успешно восстановлена!')
		} catch (err) {
			alert(err.message)
		} finally {
			setRestoringRequestId(null)
		}
	}

	const handleRestoreClient = async id => {
		if (!canRestoreClients) {
			alert('Недостаточно прав для восстановления клиента')
			return
		}

		setRestoringClientId(id)

		try {
			const res = await fetch(`${API_BASE_URL}/clients/${id}/restore`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				throw new Error(
					(await getErrorMessage(res)) || 'Ошибка при восстановлении клиента',
				)
			}

			setDeletedClients(prev => prev.filter(client => client.id !== id))
			alert('Клиент успешно восстановлен!')
		} catch (err) {
			alert(err.message)
		} finally {
			setRestoringClientId(null)
		}
	}

	const formatDate = dateString => {
		if (!dateString) return '—'
		const d = new Date(dateString)

		if (Number.isNaN(d.getTime())) return '—'

		return (
			d.toLocaleDateString('ru-RU') +
			' ' +
			d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
		)
	}

	if (!canViewTrash) {
		return (
			<div className='requests-page-container' style={{ padding: '20px' }}>
				<div className='clients-header-bar' style={{ marginBottom: '20px' }}>
					<h2>Корзина</h2>
					<span className='subtitle-text'>Восстановление удаленных данных</span>
				</div>

				<div className='validation-banner visible'>
					Недостаточно прав для просмотра корзины.
				</div>
			</div>
		)
	}

	return (
		<div className='requests-page-container' style={{ padding: '20px' }}>
			<div className='clients-header-bar' style={{ marginBottom: '20px' }}>
				<h2>Корзина</h2>
				<span className='subtitle-text'>Восстановление удаленных данных</span>
			</div>

			<div
				className='custom-tabs'
				style={{ marginBottom: '20px', justifyContent: 'flex-start' }}
			>
				{canViewRequests && (
					<button
						className={`custom-tab ${activeTab === 'requests' ? 'active' : ''}`}
						onClick={() => setActiveTab('requests')}
					>
						Удаленные заявки{' '}
						<span className='tab-badge'>{deletedRequests.length}</span>
					</button>
				)}

				{canViewClients && (
					<button
						className={`custom-tab ${activeTab === 'clients' ? 'active' : ''}`}
						onClick={() => setActiveTab('clients')}
					>
						Удаленные клиенты{' '}
						<span className='tab-badge'>{deletedClients.length}</span>
					</button>
				)}
			</div>

			{error && (
				<div
					style={{
						color: '#c62828',
						marginBottom: '15px',
						background: '#ffebee',
						padding: '10px',
						borderRadius: '4px',
					}}
				>
					{error}
				</div>
			)}

			{loading ? (
				<div style={{ color: '#888', padding: '20px' }}>
					Загрузка корзины...
				</div>
			) : (
				<div className='trash-content'>
					{canViewRequests && activeTab === 'requests' && (
						<div className='requests-list'>
							{deletedRequests.length === 0 ? (
								<div style={{ color: '#888', padding: '20px' }}>
									Корзина заявок пуста
								</div>
							) : null}

							{deletedRequests.map(req => {
								const vehicles = Array.isArray(req.vehicles) ? req.vehicles : []
								const clientSubtitle = getClientSubtitle(req)

								return (
									<div
										key={req.id}
										className='request-card'
										style={{
											opacity: 0.9,
											background: '#fefefe',
											position: 'relative',
											cursor: 'default',
										}}
									>
										<div className='card-column'>
											<div className='card-item card-item-client'>
												<span className='card-label'>
													Клиент · заявка №{req.id}
												</span>
												<span className='card-value'>
													{getRequestClientName(req)}
												</span>

												{clientSubtitle && (
													<span
														style={{
															fontSize: '12px',
															color: '#888',
															fontWeight: '400',
															marginTop: '2px',
														}}
													>
														{clientSubtitle}
													</span>
												)}

												<span
													style={{
														fontSize: '15px',
														fontWeight: '600',
														color: getWorkTypeColor(req.work_type),
														marginTop: '5px',
														display: 'inline-block',
													}}
												>
													{getWorkTypeLabel(req.work_type)}
												</span>

												{req.client_status &&
													req.client_status !== 'ACTIVE' && (
														<span
															className={`client-status-mini client-status-${req.client_status.toLowerCase()}`}
														>
															{req.client_status === 'DEBTOR'
																? 'Должник'
																: req.client_status === 'BLOCKED'
																	? 'Заблокирован'
																	: req.client_status}
														</span>
													)}
											</div>

											<div className='card-item card-item-status'>
												<span className='card-label'>Статус</span>
												<div
													className={`status-badge ${STATUS_CLASSES[req.status] || 'status-new'}`}
												>
													{STATUS_LABELS[req.status] || req.status || '—'}
												</div>
											</div>

											<div className='card-item request-creator-card-item card-item-created'>
												<span className='card-label'>Создано</span>
												<div className='request-creator-row'>
													{req.created_by_role && (
														<span
															className={`request-creator-role-badge ${ROLE_CLASSES[req.created_by_role] || 'role-tech'}`}
														>
															{ROLE_LABELS[req.created_by_role] ||
																req.created_by_role}
														</span>
													)}
													<span className='request-creator-name'>
														{req.created_by_name || 'Создатель не указан'}
													</span>
												</div>
											</div>

											{req.responsible_manager_name && (
												<div className='card-item request-creator-card-item card-item-responsible'>
													<span className='card-label'>
														Ответственный за клиента
													</span>
													<span className='request-creator-name'>
														{req.responsible_manager_name}
													</span>
												</div>
											)}
										</div>

										<div className='card-column'>
											<div className='card-item card-item-vehicles'>
												<span className='card-label'>Авто</span>
												<div className='client-request-lines'>
													{vehicles.length > 0 ? (
														vehicles.map((vehicle, index) => (
															<div
																key={vehicle.request_vehicle_id || index}
																className='client-request-line'
															>
																{getVehicleTitle(vehicle, index)}
															</div>
														))
													) : (
														<span className='card-value'>Авто не указаны</span>
													)}
												</div>
											</div>

											<div className='card-item card-item-city'>
												<span className='card-label'>Город</span>
												<span className='card-value'>
													{req.city || 'Не указан'}
												</span>
											</div>
										</div>

										<div className='card-column'>
											<div className='card-item card-item-params'>
												<span className='card-label'>Параметры</span>
												<div className='client-request-lines'>
													{req.work_type === 'INSTALLATION' &&
													vehicles.length > 0 ? (
														vehicles.map((vehicle, index) => (
															<div
																key={vehicle.request_vehicle_id || index}
																className='client-request-line'
															>
																{`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
																	`Авто ${index + 1}`}
																: {getVehicleInstallText(vehicle)}
															</div>
														))
													) : (
														<span style={{ color: '#aaa' }}>—</span>
													)}
												</div>
											</div>

											<div className='card-item card-item-format'>
												<span className='card-label'>Формат</span>
												<span className='card-value'>
													{req.visit_type === 'ON_SITE' ? (
														<>
															Выезд к клиенту
															<div
																style={{
																	fontSize: '12px',
																	color: '#2563eb',
																	marginTop: '3px',
																	fontWeight: '700',
																}}
															>
																{getVisitPriceCodeLabel(req.visit_price_code)}
															</div>
															{req.address && (
																<div
																	style={{
																		fontSize: '12px',
																		color: '#666',
																		marginTop: '3px',
																		fontWeight: 'normal',
																		lineHeight: '1.2',
																	}}
																>
																	📍 {req.address}
																</div>
															)}
														</>
													) : (
														'В офисе'
													)}
												</span>
											</div>
										</div>

										<div className='card-column'>
											<div className='card-item card-item-created-date'>
												<span className='card-label'>Дата создания заявки</span>
												<span className='card-value'>
													{formatDate(req.created_at)}
												</span>
											</div>

											<div className='card-item card-item-scheduled-date'>
												<span className='card-label'>
													Дата и время выполнения
												</span>
												<span className='card-value'>
													{formatDate(req.scheduled_at)}
												</span>

												{req.schedule_approval_status &&
													req.schedule_approval_status !== 'NOT_REQUIRED' && (
														<span
															className={`schedule-approval-badge ${
																SCHEDULE_APPROVAL_CLASSES[
																	req.schedule_approval_status
																] || 'pending'
															}`}
															title={
																req.schedule_approval_reason ||
																req.schedule_approval_comment ||
																SCHEDULE_APPROVAL_LABELS[
																	req.schedule_approval_status
																]
															}
														>
															{SCHEDULE_APPROVAL_LABELS[
																req.schedule_approval_status
															] || req.schedule_approval_status}
														</span>
													)}
											</div>

											<div className='card-item'>
												<span className='card-label'>Удалена</span>
												<span
													className='card-value'
													style={{ color: '#c62828', fontWeight: '500' }}
												>
													{formatDate(req.deleted_at)}
												</span>
											</div>

											<div className='card-item'>
												<span className='card-label'>Удалил</span>
												<span className='request-creator-name'>
													{req.deleted_by_name || 'Не указано'}
												</span>
											</div>
										</div>

										{canRestoreRequests && (
											<div
												className='card-actions-wrapper'
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: '10px',
													position: 'absolute',
													top: '15px',
													right: '15px',
												}}
											>
												<button
													className='btn-green'
													disabled={restoringRequestId === req.id}
													onClick={() => handleRestoreRequest(req.id)}
												>
													{restoringRequestId === req.id
														? 'Восстановление...'
														: 'Восстановить'}
												</button>
											</div>
										)}
									</div>
								)
							})}
						</div>
					)}

					{canViewClients && activeTab === 'clients' && (
						<div className='clients-grid'>
							{deletedClients.length === 0 ? (
								<div style={{ color: '#888', padding: '20px' }}>
									Корзина клиентов пуста
								</div>
							) : null}

							{deletedClients.map(client => (
								<div
									key={client.id}
									className='client-card'
									style={{
										opacity: 0.85,
										position: 'relative',
										background: '#fefefe',
									}}
								>
									<div
										className='client-card-title'
										style={{ textDecoration: 'line-through', color: '#888' }}
									>
										{client.company_name || client.name}
									</div>

									<div className='client-card-type'>{client.type}</div>

									<div
										className='client-card-info'
										style={{ marginTop: '10px' }}
									>
										Удален:{' '}
										<span style={{ color: '#c62828', fontWeight: '500' }}>
											{formatDate(client.deleted_at)}
										</span>
									</div>

									{canRestoreClients && (
										<div style={{ marginTop: '15px' }}>
											<button
												className='btn-green'
												style={{ width: '100%' }}
												disabled={restoringClientId === client.id}
												onClick={() => handleRestoreClient(client.id)}
											>
												{restoringClientId === client.id
													? 'Восстановление...'
													: 'Восстановить'}
											</button>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
