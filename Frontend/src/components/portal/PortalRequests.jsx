import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../../api'
import { getWorkTypeLabel, getWorkTypeColor } from '../../utils/workTypes'
import {
	canCreatePortalComment,
	canCreatePortalRequest,
	canViewPortalAttachments,
	getStoredUser,
	getUserClientId,
	isPortalReadOnly,
} from '../../utils/access'
import AttachmentsPanel from '../AttachmentsPanel'
import PortalCreateRequestModal from './PortalCreateRequestModal'
import { usePortalNotifications } from './PortalNotificationsContext'
import './styles/PortalShell.css'

const STATUS_LABELS = {
	NEW: 'В ожидании',
	IN_PROGRESS: 'Принято в работу',
	COMPLETED: 'Работы завершены',
	CANCELLED: 'Отменено',
}

const STATUS_COLORS = {
	NEW: { bg: '#eef4ff', border: '#cfe0ff', text: '#1e4b9c' },
	IN_PROGRESS: { bg: '#fff4e5', border: '#f0d9b0', text: '#8a5b00' },
	COMPLETED: { bg: '#edf7e6', border: '#cfe6b8', text: '#3f6b1a' },
	CANCELLED: { bg: '#f2f2f2', border: '#e0e0e0', text: '#777' },
}

const STATUS_FILTERS = [
	{ value: '', label: 'Все' },
	{ value: 'NEW', label: 'В ожидании' },
	{ value: 'IN_PROGRESS', label: 'В работе' },
	{ value: 'COMPLETED', label: 'Завершены' },
	{ value: 'CANCELLED', label: 'Отменены' },
]

const getStatusLabel = status => STATUS_LABELS[status] || status || '—'

const getStatusColors = status =>
	STATUS_COLORS[status] || STATUS_COLORS.CANCELLED

const formatDateTime = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleString('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return '—'
	}
}

const formatMoney = value => {
	const number = Number(value || 0)

	if (Number.isNaN(number)) return '—'

	return `${number.toLocaleString('ru-RU')} тг`
}

const getRequestClientName = request =>
	request?.company_name || request?.client_name || 'Клиент не указан'

const getVehicleTitle = (vehicle, index) => {
	const title =
		`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
		`Авто ${index + 1}`
	const plate = vehicle.plate_number || 'б/н'

	return `${title} (${plate})`
}

const getExecutorsLabel = request => {
	const executors = Array.isArray(request?.executors) ? request.executors : []

	if (executors.length === 0) return 'Пока не назначен'

	return executors
		.map(executor => executor.user_name || `Исполнитель #${executor.user_id}`)
		.join(', ')
}

export default function PortalRequests() {
	const location = useLocation()

	// Единственный опрос сервера живёт в провайдере. Здесь только
	// подписка: revision растёт — значит что-то произошло и список
	// пора перечитать.
	const { unreadByRequest, revision, markRequestRead } =
		usePortalNotifications()

	const currentUser = getStoredUser()
	const ownClientId = getUserClientId(currentUser)
	const canComment = canCreatePortalComment(currentUser)
	const canSeeFiles = canViewPortalAttachments(currentUser)

	// Право на создание и режим чтения — разные вещи. Право снимает
	// администратор, режим чтения включается блокировкой обслуживания,
	// поэтому кнопку показываем по праву, а гасим по режиму: клиент
	// должен видеть, что возможность есть, и понимать, почему она сейчас
	// недоступна.
	const canCreate = canCreatePortalRequest(currentUser)
	const readOnly = isPortalReadOnly(currentUser)

	const [requests, setRequests] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [statusFilter, setStatusFilter] = useState('')
	const [search, setSearch] = useState('')

	const [selectedRequestId, setSelectedRequestId] = useState(null)
	const [detail, setDetail] = useState(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [detailError, setDetailError] = useState('')
	const [actionLoading, setActionLoading] = useState(false)
	const [commentText, setCommentText] = useState('')

	const [showCreate, setShowCreate] = useState(false)
	const [createdMessage, setCreatedMessage] = useState('')

	// revision в зависимостях заменяет и обычную загрузку при входе:
	// на старте он равен нулю, и эффект отрабатывает один раз.
	useEffect(() => {
		fetchRequests()
	}, [revision])

	useEffect(() => {
		if (!selectedRequestId) {
			setDetail(null)
			setCommentText('')
			setDetailError('')
			return
		}

		fetchDetail(selectedRequestId)

		// Карточка открыта — значит клиент увидел всё, что по ней
		// произошло. Повторяем при каждом revision: пока карточка
		// открыта, новые события тоже считаются просмотренными.
		markRequestRead(selectedRequestId)
	}, [selectedRequestId, revision])

	// Переход из колокольчика или из всплывающего уведомления.
	// portalActionId нужен, чтобы повторный клик по той же заявке
	// снова открыл карточку: сам openRequestId при этом не меняется.
	useEffect(() => {
		const openRequestId = location.state?.openRequestId

		if (!openRequestId) return

		setSelectedRequestId(Number(openRequestId))
	}, [location.state?.openRequestId, location.state?.portalActionId])

	const readError = async (res, fallback) => {
		const data = await res.json().catch(() => null)
		return data?.detail || fallback
	}

	const fetchRequests = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(`${API_BASE_URL}/requests`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось загрузить заявки'))
			}

			const data = await res.json()
			setRequests(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
			setRequests([])
		} finally {
			setLoading(false)
		}
	}

	const fetchDetail = async requestId => {
		setDetailLoading(true)
		setDetailError('')

		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось загрузить заявку'))
			}

			setDetail(await res.json())
		} catch (err) {
			setDetailError(err.message)
			setDetail(null)
		} finally {
			setDetailLoading(false)
		}
	}

	const handleCancel = async request => {
		const confirmText =
			`Отменить заявку №${request.id}?\n\n` +
			'Отменённую заявку вернуть нельзя — потребуется создать новую.'

		if (!window.confirm(confirmText)) return

		setActionLoading(true)
		setDetailError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/requests/${request.id}/portal/cancel`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось отменить заявку'))
			}

			await fetchRequests()

			if (selectedRequestId === request.id) {
				await fetchDetail(request.id)
			}
		} catch (err) {
			setDetailError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const handleCommentSubmit = async e => {
		e.preventDefault()

		const message = commentText.trim()

		if (!message || !selectedRequestId) return

		setActionLoading(true)
		setDetailError('')

		try {
			const res = await fetch(`${API_BASE_URL}/requests/comments`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					request_id: selectedRequestId,
					message,
				}),
			})

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось отправить сообщение'))
			}

			setCommentText('')
			await fetchDetail(selectedRequestId)
		} catch (err) {
			setDetailError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const handleCreated = async result => {
		setShowCreate(false)

		const priceText =
			result?.total_price === null || result?.total_price === undefined
				? ''
				: ` Стоимость: ${formatMoney(result.total_price)}.`

		setCreatedMessage(
			`Заявка №${result.request_id} создана.${priceText}` +
				(result?.schedule_approval_status === 'PENDING'
					? ' Выбранное время нерабочее — заявка ждёт подтверждения руководителя.'
					: ''),
		)

		await fetchRequests()
	}

	const visibleRequests = useMemo(() => {
		const query = search.trim().toLowerCase()

		return requests.filter(request => {
			if (statusFilter && request.status !== statusFilter) return false

			if (!query) return true

			const searchable = [
				`№${request.id}`,
				String(request.id),
				getRequestClientName(request),
				request.city,
				request.address,
				request.platform,
				getWorkTypeLabel(request.work_type),
				...(request.vehicles || []).map(vehicle =>
					[vehicle.brand, vehicle.model, vehicle.plate_number, vehicle.vin]
						.filter(Boolean)
						.join(' '),
				),
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()

			return searchable.includes(query)
		})
	}, [requests, statusFilter, search])

	const detailRequest = detail?.request || null

	return (
		<div className='portal-req-page'>
			<style>{`
				.portal-req-page {
					padding: 24px 20px 40px;
				}

				.portal-req-page h2 {
					margin: 0 0 4px;
					font-size: 20px;
					color: #222;
				}

				.portal-req-subtitle {
					font-size: 13px;
					color: #777;
					margin-bottom: 18px;
				}

				.portal-req-toolbar {
					display: flex;
					gap: 10px;
					flex-wrap: wrap;
					align-items: center;
					margin-bottom: 16px;
				}

				.portal-req-filter {
					border: 1px solid #ddd;
					background: #fff;
					border-radius: 20px;
					padding: 5px 14px;
					font-size: 13px;
					color: #555;
					cursor: pointer;
				}

				.portal-req-filter.active {
					border-color: var(--pb-border, #cfe6b8);
					background: var(--pb-soft-bg, #f0f7e8);
					color: var(--pb-soft-text, #3f6b1a);
					font-weight: 600;
				}

				.portal-req-search {
					border: 1px solid #ddd;
					border-radius: 6px;
					padding: 8px 11px;
					font-size: 14px;
					min-width: 240px;
					flex: 1 1 240px;
					box-sizing: border-box;
				}

				.portal-req-card {
					background: #fff;
					border: 1px solid #e6e6e6;
					border-radius: 10px;
					padding: 14px 16px;
					margin-bottom: 10px;
				}

				.portal-req-card.subclient {
					border-left: 3px solid #1e4b9c;
				}

				.portal-req-card-top {
					display: flex;
					justify-content: space-between;
					gap: 12px;
					flex-wrap: wrap;
					align-items: baseline;
				}

				.portal-req-number {
					font-size: 15px;
					font-weight: 700;
					color: #222;
				}

				.portal-req-status {
					font-size: 11px;
					font-weight: 700;
					padding: 3px 10px;
					border-radius: 12px;
					white-space: nowrap;
				}

				.portal-req-badge {
					display: inline-block;
					font-size: 11px;
					font-weight: 700;
					padding: 2px 8px;
					border-radius: 10px;
					background: #eef4ff;
					color: #1e4b9c;
					border: 1px solid #cfe0ff;
					margin-left: 8px;
				}

				.portal-req-meta {
					font-size: 13px;
					color: #666;
					margin-top: 6px;
					line-height: 1.55;
				}

				.portal-req-work {
					font-weight: 600;
				}

				.portal-req-card-actions {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
					margin-top: 12px;
				}

				.portal-req-btn {
					border: 1px solid #ddd;
					background: #fff;
					border-radius: 6px;
					padding: 7px 14px;
					font-size: 13px;
					color: #444;
					cursor: pointer;
				}

				.portal-req-btn.primary {
					background: var(--pb-primary, #5e9424);
					border-color: var(--pb-primary, #5e9424);
					color: var(--pb-on-primary, #fff);
					font-weight: 600;
				}

				.portal-req-btn.danger {
					border-color: #f5c6cb;
					color: #b71c1c;
				}

				.portal-req-btn:disabled {
					opacity: 0.6;
					cursor: not-allowed;
				}

				.portal-req-banner {
					padding: 10px 12px;
					border-radius: 8px;
					font-size: 13px;
					line-height: 1.45;
					margin-bottom: 14px;
				}

				.portal-req-banner.error {
					background: #fdecea;
					border: 1px solid #f5c6cb;
					color: #b71c1c;
				}

				.portal-req-banner.info {
					background: #f4f6f8;
					border: 1px solid #e0e4e8;
					color: #555;
				}

				.portal-req-empty {
					padding: 30px 0;
					text-align: center;
					color: #888;
					font-size: 14px;
				}

				.portal-req-modal {
					max-width: 780px;
					width: 96%;
				}

				.portal-req-modal-body {
					padding: 16px 20px 20px;
					max-height: 72vh;
					overflow-y: auto;
				}

				.portal-req-section {
					border: 1px solid #eee;
					border-radius: 10px;
					padding: 14px;
					margin-bottom: 14px;
					background: #fff;
				}

				.portal-req-section-title {
					font-size: 14px;
					font-weight: 700;
					color: #222;
					margin-bottom: 10px;
				}

				.portal-req-row {
					display: flex;
					justify-content: space-between;
					gap: 16px;
					padding: 7px 0;
					border-bottom: 1px solid #f4f4f4;
					font-size: 14px;
				}

				.portal-req-row:last-child {
					border-bottom: none;
				}

				.portal-req-row-key {
					color: #777;
				}

				.portal-req-row-val {
					color: #222;
					font-weight: 600;
					text-align: right;
					word-break: break-word;
				}

				.portal-req-line {
					font-size: 13px;
					color: #444;
					padding: 4px 0;
					line-height: 1.5;
				}

				.portal-req-comment {
					border: 1px solid #eee;
					border-radius: 8px;
					padding: 9px 11px;
					margin-bottom: 8px;
					background: #fbfbfb;
				}

				.portal-req-comment-head {
					display: flex;
					justify-content: space-between;
					gap: 10px;
					font-size: 12px;
					color: #888;
					margin-bottom: 4px;
				}

				.portal-req-comment-text {
					font-size: 14px;
					color: #222;
					line-height: 1.5;
					white-space: pre-wrap;
					word-break: break-word;
				}

				.portal-req-textarea {
					border: 1px solid #ddd;
					border-radius: 6px;
					padding: 9px 11px;
					font-size: 14px;
					width: 100%;
					box-sizing: border-box;
					min-height: 78px;
					font-family: inherit;
					resize: vertical;
				}

				.portal-req-history-row {
					font-size: 13px;
					color: #555;
					padding: 6px 0;
					border-bottom: 1px solid #f4f4f4;
					line-height: 1.5;
				}

				.portal-req-history-row:last-child {
					border-bottom: none;
				}

				.portal-req-history-date {
					color: #999;
					font-size: 12px;
				}

				.portal-req-head {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					gap: 16px;
					flex-wrap: wrap;
				}

				.portal-req-banner.success {
					background: #edf7e6;
					border: 1px solid #cfe6b8;
					color: #3f6b1a;
				}
			`}</style>

			<div className='portal-req-head'>
				<div>
					<h2>Заявки</h2>
					<div className='portal-req-subtitle'>
						Заявки вашей организации и организаций в вашей структуре.
					</div>
				</div>

				{canCreate && (
					<button
						type='button'
						className='portal-req-btn primary'
						onClick={() => setShowCreate(true)}
						disabled={readOnly}
						title={
							readOnly
								? 'Обслуживание приостановлено. Обратитесь к вашему менеджеру.'
								: undefined
						}
					>
						Создать заявку
					</button>
				)}
			</div>

			{createdMessage && (
				<div className='portal-req-banner success'>{createdMessage}</div>
			)}

			{error && <div className='portal-req-banner error'>{error}</div>}

			<div className='portal-req-toolbar'>
				{STATUS_FILTERS.map(item => (
					<button
						key={item.value || 'all'}
						type='button'
						className={`portal-req-filter ${statusFilter === item.value ? 'active' : ''}`}
						onClick={() => setStatusFilter(item.value)}
					>
						{item.label}
					</button>
				))}

				<input
					className='portal-req-search'
					value={search}
					onChange={e => setSearch(e.target.value)}
					placeholder='Номер, авто, госномер, VIN, адрес...'
				/>
			</div>

			{loading ? (
				<div className='portal-req-empty'>Загрузка заявок...</div>
			) : visibleRequests.length === 0 ? (
				<div className='portal-req-empty'>
					{requests.length === 0
						? 'Заявок пока нет'
						: 'По выбранным условиям ничего не найдено'}
				</div>
			) : (
				visibleRequests.map(request => {
					const colors = getStatusColors(request.status)
					const isSubclient = Boolean(request.is_inherited_access)
					const vehicles = request.vehicles || []

					// Решение Р32(А): «заявка изменилась» = по ней есть
					// непрочитанные уведомления. Отдельного признака
					// в заявке нет и не нужно — источник правды один.
					const changes = unreadByRequest[String(request.id)]

					return (
						<div
							key={request.id}
							className={`portal-req-card ${isSubclient ? 'subclient' : ''} ${
								changes ? 'pn-changed' : ''
							}`}
						>
							<div className='portal-req-card-top'>
								<div>
									<span className='portal-req-number'>
										Заявка №{request.id}
									</span>

									{changes && (
										<span className='pn-changed-badge'>
											{changes.unreadCount > 1
												? `${changes.unreadCount} изменения`
												: 'изменилась'}
										</span>
									)}

									{isSubclient && (
										<span className='portal-req-badge'>
											{getRequestClientName(request)}
										</span>
									)}
								</div>

								<span
									className='portal-req-status'
									style={{
										background: colors.bg,
										border: `1px solid ${colors.border}`,
										color: colors.text,
									}}
								>
									{getStatusLabel(request.status)}
								</span>
							</div>

							<div className='portal-req-meta'>
								<span
									className='portal-req-work'
									style={{ color: getWorkTypeColor(request.work_type) }}
								>
									{getWorkTypeLabel(request.work_type)}
								</span>
								{' · '}
								{formatDateTime(request.scheduled_at)}
								<br />
								{request.visit_type === 'ON_SITE'
									? `Выезд: ${request.address || request.city || 'адрес не указан'}`
									: `В офисе${request.city ? ` · ${request.city}` : ''}`}
								<br />
								{vehicles.length === 0
									? 'Авто не указаны'
									: vehicles
											.map((vehicle, index) => getVehicleTitle(vehicle, index))
											.join(', ')}
							</div>

							{changes && (
								<div className='pn-changed-note'>
									<span>{changes.lastMessage || changes.lastTitle}</span>
								</div>
							)}

							<div className='portal-req-card-actions'>
								<button
									type='button'
									className='portal-req-btn'
									onClick={() => setSelectedRequestId(request.id)}
								>
									Подробнее
								</button>

								{request.can_cancel && (
									<button
										type='button'
										className='portal-req-btn danger'
										onClick={() => handleCancel(request)}
										disabled={actionLoading}
									>
										Отменить
									</button>
								)}
							</div>
						</div>
					)
				})
			)}

			{selectedRequestId && (
				<div
					className='modal-overlay open'
					onClick={() => setSelectedRequestId(null)}
				>
					<div
						className='modal-window portal-req-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Заявка №{selectedRequestId}</span>

							<button
								className='modal-close'
								type='button'
								onClick={() => setSelectedRequestId(null)}
							>
								&times;
							</button>
						</div>

						<div className='portal-req-modal-body'>
							{detailError && (
								<div className='portal-req-banner error'>{detailError}</div>
							)}

							{detailLoading ? (
								<div className='portal-req-empty'>Загрузка...</div>
							) : !detailRequest ? (
								<div className='portal-req-empty'>Заявка не найдена</div>
							) : (
								<>
									<div className='portal-req-section'>
										<div className='portal-req-section-title'>О заявке</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Статус</span>
											<span className='portal-req-row-val'>
												{getStatusLabel(detailRequest.status)}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Вид работ</span>
											<span className='portal-req-row-val'>
												{getWorkTypeLabel(detailRequest.work_type)}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>
												Дата и время работ
											</span>
											<span className='portal-req-row-val'>
												{formatDateTime(detailRequest.scheduled_at)}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Формат</span>
											<span className='portal-req-row-val'>
												{detailRequest.visit_type === 'ON_SITE'
													? `Выезд · ${detailRequest.address || 'адрес не указан'}`
													: 'В офисе'}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Город</span>
											<span className='portal-req-row-val'>
												{detailRequest.city || '—'}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Платформа</span>
											<span className='portal-req-row-val'>
												{detailRequest.platform || '—'}
											</span>
										</div>

										<div className='portal-req-row'>
											<span className='portal-req-row-key'>Исполнитель</span>
											<span className='portal-req-row-val'>
												{getExecutorsLabel(detailRequest)}
											</span>
										</div>

										{ownClientId !== null &&
											detailRequest.client_id !== null &&
											Number(detailRequest.client_id) !==
												Number(ownClientId) && (
												<div className='portal-req-row'>
													<span className='portal-req-row-key'>
														Организация
													</span>
													<span className='portal-req-row-val'>
														{getRequestClientName(detailRequest)}
													</span>
												</div>
											)}

										{detailRequest.can_view_prices && (
											<div className='portal-req-row'>
												<span className='portal-req-row-key'>Стоимость</span>
												<span className='portal-req-row-val'>
													{formatMoney(detailRequest.total_price)}
												</span>
											</div>
										)}
									</div>

									<div className='portal-req-section'>
										<div className='portal-req-section-title'>Автомобили</div>

										{(detail.vehicles || []).length === 0 ? (
											<div className='portal-req-line'>Авто не указаны</div>
										) : (
											detail.vehicles.map((vehicle, index) => (
												<div
													key={vehicle.request_vehicle_id || index}
													className='portal-req-line'
												>
													{getVehicleTitle(vehicle, index)}
													{vehicle.vin ? ` · VIN: ${vehicle.vin}` : ''}
												</div>
											))
										)}
									</div>

									{/* Файлы заявки.

									    Панель та же, что в CRM: список, загрузка и права
									    на каждый файл считает сервер, а не интерфейс.
									    Внутренние файлы сюда не попадают — их отсекает
									    user_can_view_attachment до выдачи списка. */}
									{canSeeFiles && (
										<div className='portal-req-section'>
											<div className='portal-req-section-title'>
												Файлы заявки
											</div>

											<AttachmentsPanel
												title=''
												entityType='REQUEST'
												entityId={detailRequest.id}
											/>
										</div>
									)}

									{detailRequest.can_view_prices &&
										(detail.price_lines || []).length > 0 && (
											<div className='portal-req-section'>
												<div className='portal-req-section-title'>
													Расчёт стоимости
												</div>

												{detail.price_lines.map(line => (
													<div key={line.id} className='portal-req-row'>
														<span className='portal-req-row-key'>
															{line.label} · {line.quantity} {line.unit || 'шт'}
														</span>
														<span className='portal-req-row-val'>
															{formatMoney(line.total_price)}
														</span>
													</div>
												))}

												<div className='portal-req-row'>
													<span className='portal-req-row-key'>
														<strong>Итого</strong>
													</span>
													<span className='portal-req-row-val'>
														{formatMoney(detailRequest.total_price)}
													</span>
												</div>
											</div>
										)}

									<div className='portal-req-section'>
										<div className='portal-req-section-title'>
											Переписка по заявке
										</div>

										{(detail.comments || []).length === 0 ? (
											<div className='portal-req-line'>Сообщений пока нет.</div>
										) : (
											detail.comments.map(comment => (
												<div key={comment.id} className='portal-req-comment'>
													<div className='portal-req-comment-head'>
														<span>{comment.author || 'Сотрудник'}</span>
														<span>{formatDateTime(comment.created_at)}</span>
													</div>

													<div className='portal-req-comment-text'>
														{comment.message}
													</div>
												</div>
											))
										)}

										{canComment ? (
											<form
												onSubmit={handleCommentSubmit}
												style={{ marginTop: 12 }}
											>
												<textarea
													className='portal-req-textarea'
													value={commentText}
													onChange={e => setCommentText(e.target.value)}
													placeholder='Напишите сообщение вашему менеджеру...'
												/>

												<div style={{ marginTop: 8 }}>
													<button
														type='submit'
														className='portal-req-btn primary'
														disabled={actionLoading || !commentText.trim()}
													>
														{actionLoading ? 'Отправка...' : 'Отправить'}
													</button>
												</div>
											</form>
										) : (
											<div
												className='portal-req-banner info'
												style={{ marginTop: 12 }}
											>
												Отправка сообщений недоступна. Свяжитесь с вашим
												менеджером.
											</div>
										)}
									</div>

									{(detail.history || []).length > 0 && (
										<div className='portal-req-section'>
											<div className='portal-req-section-title'>
												Что происходило с заявкой
											</div>

											{detail.history.map((row, index) => (
												<div key={index} className='portal-req-history-row'>
													{row.action === 'STATUS_CHANGED'
														? `Статус: ${getStatusLabel(row.old_value)} → ${getStatusLabel(row.new_value)}`
														: row.new_value || row.action}
													<br />
													<span className='portal-req-history-date'>
														{formatDateTime(row.created_at)}
														{row.user_name ? ` · ${row.user_name}` : ''}
													</span>
												</div>
											))}
										</div>
									)}
								</>
							)}
						</div>

						<div className='modal-footer'>
							{detailRequest?.can_cancel && (
								<button
									type='button'
									className='portal-req-btn danger'
									onClick={() => handleCancel(detailRequest)}
									disabled={actionLoading}
								>
									Отменить заявку
								</button>
							)}

							<button
								type='button'
								className='portal-req-btn'
								onClick={() => setSelectedRequestId(null)}
							>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}

			{showCreate && (
				<PortalCreateRequestModal
					onClose={() => setShowCreate(false)}
					onCreated={handleCreated}
				/>
			)}
		</div>
	)
}
