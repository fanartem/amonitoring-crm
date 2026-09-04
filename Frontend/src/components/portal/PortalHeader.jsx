import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../../api'
import {
	canViewPortalRequests,
	getStoredUser,
	getUserClientName,
} from '../../utils/access'
import {
	formatPortalNotificationDate,
	usePortalNotifications,
} from './PortalNotificationsContext'
import './styles/PortalShell.css'

// Шапка кабинета.
//
// Раньше это был белый прямоугольник с текстом по умолчанию — рядом
// с зелёным сайдбаром он выглядел как чужой элемент. Теперь цвет тот же,
// что у сайдбара, и шапка читается с ним как одна панель.
//
// Логотип приходит готовой строкой data-URI из PortalApp: запрос за
// оформлением один на весь кабинет, и шапка в него не ходит.
// Решение Р60(А): в шапке только логотип клиента, нашего знака рядом нет.
//
// Колокольчик живёт здесь же и берёт данные из общего провайдера:
// собственного опроса у него нет.

const DROPDOWN_LIMIT = 15

export default function PortalHeader({ user, logoDataUrl = null }) {
	const navigate = useNavigate()

	const currentUser = user || getStoredUser()
	const clientName = getUserClientName(currentUser)
	const canSeeNotifications = canViewPortalRequests(currentUser)

	const {
		unreadCount,
		unreadByRequest,
		revision,
		markAllRead,
		markRequestRead,
	} = usePortalNotifications()

	const [isOpen, setOpen] = useState(false)
	const [items, setItems] = useState([])
	const [loading, setLoading] = useState(false)

	const wrapperRef = useRef(null)

	useEffect(() => {
		const handleClickOutside = event => {
			if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
				setOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)

		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	// Список тянем только когда его открыли, и перечитываем, если пока
	// он открыт пришло новое. Держать его загруженным постоянно незачем.
	useEffect(() => {
		if (!isOpen) return

		fetchItems()
	}, [isOpen, revision])

	const fetchItems = async () => {
		setLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/portal/notifications?limit=${DROPDOWN_LIMIT}`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				setItems([])
				return
			}

			const data = await res.json()

			setItems(Array.isArray(data.items) ? data.items : [])
		} catch (err) {
			console.error('Не удалось загрузить уведомления:', err)
			setItems([])
		} finally {
			setLoading(false)
		}
	}

	const handleItemClick = async item => {
		setOpen(false)

		if (item.request_id) {
			// Помечаем прочитанным всю заявку, а не одно уведомление:
			// клиент сейчас увидит карточку целиком, вместе со всем,
			// что по ней произошло.
			await markRequestRead(item.request_id)

			navigate('/portal/requests', {
				state: {
					openRequestId: item.request_id,
					portalActionId: `${Date.now()}-${Math.random()}`,
				},
			})
		}
	}

	const unreadRequestsCount = Object.keys(unreadByRequest || {}).length

	return (
		<header className='portal-header'>
			<div className='portal-header-brand'>
				{logoDataUrl && (
					<img
						className='portal-header-logo'
						src={logoDataUrl}
						alt={clientName || 'Логотип организации'}
					/>
				)}

				<div className='portal-header-brand-text'>
					<div className='portal-header-title'>Личный кабинет</div>

					{clientName && (
						<div className='portal-header-client'>{clientName}</div>
					)}
				</div>
			</div>

			<div className='portal-header-right'>
				{canSeeNotifications && (
					<div className='pn-bell-wrap' ref={wrapperRef}>
						<button
							type='button'
							className='pn-bell-btn'
							title='Уведомления'
							onClick={() => setOpen(prev => !prev)}
						>
							<svg
								width='21'
								height='21'
								viewBox='0 0 24 24'
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								strokeLinecap='round'
								strokeLinejoin='round'
							>
								<path d='M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' />
								<path d='M13.73 21a2 2 0 0 1-3.46 0' />
							</svg>

							{unreadCount > 0 && (
								<span className='pn-bell-badge'>
									{unreadCount > 99 ? '99+' : unreadCount}
								</span>
							)}
						</button>

						{isOpen && (
							<div className='pn-dropdown'>
								<div className='pn-dropdown-head'>
									<div>
										<div className='pn-dropdown-title'>Уведомления</div>
										<div className='pn-dropdown-subtitle'>
											{unreadCount > 0
												? `Непрочитанных: ${unreadCount}` +
													(unreadRequestsCount > 1
														? ` · заявок: ${unreadRequestsCount}`
														: '')
												: 'Нет непрочитанных'}
										</div>
									</div>

									{unreadCount > 0 && (
										<button
											type='button'
											className='pn-dropdown-action'
											onClick={markAllRead}
										>
											Прочитать все
										</button>
									)}
								</div>

								<div className='pn-dropdown-list'>
									{loading ? (
										<div className='pn-dropdown-empty'>Загрузка...</div>
									) : items.length === 0 ? (
										<div className='pn-dropdown-empty'>
											Уведомлений пока нет
										</div>
									) : (
										items.map(item => (
											<button
												key={item.id}
												type='button'
												className={`pn-item ${item.is_read ? 'read' : 'unread'}`}
												onClick={() => handleItemClick(item)}
											>
												<div className='pn-item-main'>
													<div className='pn-item-title'>{item.title}</div>
													<div className='pn-item-message'>{item.message}</div>
													<div className='pn-item-date'>
														{formatPortalNotificationDate(item.created_at)}
													</div>
												</div>

												{!item.is_read && <span className='pn-item-dot' />}
											</button>
										))
									)}
								</div>
							</div>
						)}
					</div>
				)}

				<div className='portal-header-user'>
					<div className='portal-header-user-name'>
						{currentUser?.name || currentUser?.email || 'Пользователь'}
					</div>

					{currentUser?.email && currentUser?.name && (
						<div className='portal-header-user-email'>{currentUser.email}</div>
					)}
				</div>
			</div>
		</header>
	)
}
