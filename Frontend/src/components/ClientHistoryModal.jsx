import React, { useEffect, useState } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'

// Значения action, которые пишет бэкенд: clients.py (карточка, статус,
// оплата, ответственный, родитель, параметры установки), portal_users.py
// и auth.py (учётные записи кабинета). Неизвестный код показываем как есть —
// лучше сырой код, чем пустая строка.
const ACTION_LABELS = {
	CLIENT_CREATED: 'Клиент создан',
	CLIENT_UPDATED: 'Данные клиента изменены',
	CLIENT_DELETED: 'Клиент перемещён в корзину',
	CLIENT_RESTORED: 'Клиент восстановлен',
	PARENT_CHANGED: 'Изменён родительский клиент',
	STATUS_CHANGED: 'Изменён статус',
	PAYMENT_TYPE_CHANGED: 'Изменён тип оплаты',
	RESPONSIBLE_CHANGED: 'Изменён ответственный',
	INSTALLATION_SETTINGS_UPDATED: 'Изменены параметры установки',
	INSTALLATION_SETTINGS_RESET: 'Параметры установки сброшены',

	PORTAL_USER_CREATED: 'Создана учётная запись портала',
	PORTAL_USER_ENABLED: 'Учётная запись портала включена',
	PORTAL_USER_DISABLED: 'Учётная запись портала отключена',
	PORTAL_USER_DELETED: 'Удалена учётная запись портала',
	PORTAL_USER_PASSWORD_SET: 'Задан новый пароль учётной записи портала',
	PORTAL_USER_PERMISSIONS_UPDATED: 'Изменены доступы учётной записи портала',
	PORTAL_PASSWORD_CHANGED: 'Пользователь портала сменил свой пароль',
	SUBCLIENT_CREATED: 'Клиент добавил организацию в свою структуру',
}

const FIELD_LABELS = {
	name: 'ФИО / Название',
	company_name: 'Наименование',
	bin_iin: 'БИН / ИИН',
	phone: 'Телефон',
	email: 'Email',
	monitoring_login: 'Логин мониторинга',
	monitoring_password: 'Пароль мониторинга',
	status: 'Статус',
	payment_type: 'Тип оплаты',
	responsible_manager_id: 'Ответственный',
	parent_client_id: 'Родительский клиент',
	portal_user: 'Учётная запись портала',
	portal_user_permissions: 'Доступы портала',
	subclient: 'Подклиент',
}

const STATUS_VALUE_LABELS = {
	ACTIVE: 'Активный',
	DEBTOR: 'Должник',
	BLOCKED: 'Заблокирован',
	PREPAYMENT: 'Предоплата',
	POSTPAYMENT: 'Постоплата',
}

const PORTAL_ACTION_PREFIX = 'PORTAL_'

const FILTER_ALL = 'all'
const FILTER_PORTAL = 'portal'

const getActionLabel = action => ACTION_LABELS[action] || action || 'Изменение'

const getFieldLabel = fieldName => {
	if (!fieldName) return null

	return FIELD_LABELS[fieldName] || fieldName
}

const getValueLabel = value => {
	if (value === null || value === undefined || value === '') return '—'

	return STATUS_VALUE_LABELS[value] || String(value)
}

const isPortalAction = row =>
	String(row?.action || '').startsWith(PORTAL_ACTION_PREFIX)

const formatDateTime = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleString('ru-RU')
	} catch {
		return '—'
	}
}

export default function ClientHistoryModal({ isOpen, client, onClose }) {
	const clientId = client?.id || null

	const [rows, setRows] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [filter, setFilter] = useState(FILTER_ALL)

	useEffect(() => {
		if (!isOpen || !clientId) return

		setFilter(FILTER_ALL)
		fetchHistory()
	}, [isOpen, clientId])

	const fetchHistory = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/history?limit=200`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить историю клиента')
			}

			const data = await res.json()
			setRows(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
			setRows([])
		} finally {
			setLoading(false)
		}
	}

	if (!isOpen || !clientId) return null

	const visibleRows =
		filter === FILTER_PORTAL ? rows.filter(isPortalAction) : rows

	const portalRowsCount = rows.filter(isPortalAction).length

	const clientTitle =
		client?.company_name || client?.name || `Клиент #${clientId}`

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window client-history-modal'
				onClick={e => e.stopPropagation()}
			>
				<style>{`
					.client-history-modal {
						max-width: 860px;
						width: 96%;
					}

					.client-history-body {
						padding: 16px 20px 20px;
						max-height: 70vh;
						overflow-y: auto;
					}

					.client-history-client {
						font-size: 12px;
						color: #777;
						margin-bottom: 12px;
					}

					.client-history-filters {
						display: flex;
						gap: 8px;
						flex-wrap: wrap;
						margin-bottom: 14px;
					}

					.client-history-filter {
						border: 1px solid #ddd;
						background: #fff;
						border-radius: 20px;
						padding: 5px 14px;
						font-size: 13px;
						color: #555;
						cursor: pointer;
					}

					.client-history-filter.active {
						border-color: #cfe6b8;
						background: #f0f7e8;
						color: #3f6b1a;
						font-weight: 600;
					}

					.client-history-row {
						border: 1px solid #eee;
						border-radius: 8px;
						padding: 11px 13px;
						margin-bottom: 8px;
						background: #fff;
					}

					.client-history-row.portal {
						border-left: 3px solid #0f766e;
					}

					.client-history-row-top {
						display: flex;
						justify-content: space-between;
						gap: 12px;
						flex-wrap: wrap;
						align-items: baseline;
					}

					.client-history-action {
						font-size: 14px;
						font-weight: 600;
						color: #222;
					}

					.client-history-date {
						font-size: 12px;
						color: #888;
						white-space: nowrap;
					}

					.client-history-meta {
						font-size: 12px;
						color: #777;
						margin-top: 5px;
						line-height: 1.5;
					}

					.client-history-change {
						font-size: 13px;
						color: #444;
						margin-top: 5px;
						line-height: 1.5;
						word-break: break-word;
					}

					.client-history-arrow {
						color: #999;
						margin: 0 6px;
					}

					.client-history-empty {
						padding: 26px 0;
						text-align: center;
						color: #888;
						font-size: 14px;
					}

					.client-history-error {
						padding: 10px 12px;
						border-radius: 8px;
						background: #fdecea;
						border: 1px solid #f5c6cb;
						color: #b71c1c;
						font-size: 13px;
						margin-bottom: 12px;
					}
				`}</style>

				<div className='modal-header'>
					<span className='modal-title'>История изменений клиента</span>

					<button className='modal-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				<div className='client-history-body'>
					<div className='client-history-client'>Клиент: {clientTitle}</div>

					{error && <div className='client-history-error'>{error}</div>}

					<div className='client-history-filters'>
						<button
							type='button'
							className={`client-history-filter ${filter === FILTER_ALL ? 'active' : ''}`}
							onClick={() => setFilter(FILTER_ALL)}
						>
							Все изменения ({rows.length})
						</button>

						<button
							type='button'
							className={`client-history-filter ${filter === FILTER_PORTAL ? 'active' : ''}`}
							onClick={() => setFilter(FILTER_PORTAL)}
						>
							Доступ в портал ({portalRowsCount})
						</button>
					</div>

					{loading ? (
						<div className='client-history-empty'>Загрузка истории...</div>
					) : visibleRows.length === 0 ? (
						<div className='client-history-empty'>
							{filter === FILTER_PORTAL
								? 'По учётным записям портала изменений пока нет'
								: 'История пуста'}
						</div>
					) : (
						visibleRows.map(row => {
							const fieldLabel = getFieldLabel(row.field_name)
							const hasChange = row.old_value !== null || row.new_value !== null

							return (
								<div
									key={row.id}
									className={`client-history-row ${isPortalAction(row) ? 'portal' : ''}`}
								>
									<div className='client-history-row-top'>
										<span className='client-history-action'>
											{getActionLabel(row.action)}
										</span>

										<span className='client-history-date'>
											{formatDateTime(row.created_at)}
										</span>
									</div>

									{hasChange && (
										<div className='client-history-change'>
											{fieldLabel && <strong>{fieldLabel}: </strong>}
											{getValueLabel(row.old_value)}
											<span className='client-history-arrow'>→</span>
											{getValueLabel(row.new_value)}
										</div>
									)}

									{row.comment && (
										<div className='client-history-change'>{row.comment}</div>
									)}

									<div className='client-history-meta'>
										Автор: {row.user_name || 'Система'}
									</div>
								</div>
							)
						})
					)}
				</div>

				<div className='modal-footer'>
					<button type='button' className='btn-details' onClick={onClose}>
						Закрыть
					</button>
				</div>
			</div>
		</div>
	)
}
