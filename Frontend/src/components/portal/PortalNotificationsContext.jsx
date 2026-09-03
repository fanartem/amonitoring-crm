import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'
import { useNavigate } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../../api'
import { canViewPortalRequests, getStoredUser } from '../../utils/access'
import './styles/PortalShell.css'

// Уведомления кабинета: опрос, всплывающие окна и общий сигнал
// «данные устарели» для открытых вкладок.
//
// Один опрос на весь кабинет, а не по опросу в каждой вкладке.
// Иначе три открытых раздела дали бы три запроса в минуту на пустом
// месте, а всплывающее окно показалось бы трижды.
//
// Почему опрос, а не WebSocket: сокет потребовал бы правок в nginx
// и в запуске uvicorn, а выигрыш при задержке в полминуты для заявок
// на монтаж — никакой. Механизм заменяется в одном месте, если
// однажды понадобится мгновенность.

const POLL_INTERVAL_MS = 30000
const TOAST_LIFETIME_MS = 9000
const MAX_TOASTS = 3
const MAX_NEW_ITEMS_PER_POLL = 20

const EMPTY_STATE = {
	unreadCount: 0,
	unreadByRequest: {},
	revision: 0,
	refresh: () => {},
	markRequestRead: () => {},
	markAllRead: () => {},
}

const PortalNotificationsContext = createContext(EMPTY_STATE)

export const usePortalNotifications = () =>
	useContext(PortalNotificationsContext) || EMPTY_STATE

/**
 * Подписка вкладки на обновления.
 *
 * Возвращает число, которое растёт при каждом новом уведомлении.
 * Вкладка кладёт его в зависимости своего useEffect — и перезагружает
 * данные, когда что-то произошло.
 */
export const usePortalDataRevision = () => usePortalNotifications().revision

const formatDateTime = value => {
	if (!value) return ''

	try {
		return new Date(value).toLocaleString('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return ''
	}
}

function PortalToasts({ items, onDismiss, onOpen }) {
	if (items.length === 0) return null

	return (
		<div className='pn-toasts'>
			{items.map(item => (
				<div key={item.id} className='pn-toast'>
					<button
						type='button'
						className='pn-toast-body'
						onClick={() => onOpen(item)}
					>
						<div className='pn-toast-title'>{item.title}</div>
						<div className='pn-toast-message'>{item.message}</div>
					</button>

					<button
						type='button'
						className='pn-toast-close'
						onClick={() => onDismiss(item.id)}
						aria-label='Закрыть'
					>
						&times;
					</button>
				</div>
			))}
		</div>
	)
}

export function PortalNotificationsProvider({ children }) {
	const navigate = useNavigate()

	const currentUser = getStoredUser()
	const isEnabled = canViewPortalRequests(currentUser)

	const [unreadCount, setUnreadCount] = useState(0)
	const [unreadByRequest, setUnreadByRequest] = useState({})
	const [revision, setRevision] = useState(0)
	const [toasts, setToasts] = useState([])

	// null означает «ещё ни разу не опрашивали». При первом ответе
	// всплывающие окна не показываем: иначе при каждом открытии кабинета
	// клиенту вываливалась бы вся история за неделю.
	const lastSeenIdRef = useRef(null)
	const isFetchingRef = useRef(false)

	const dismissToast = useCallback(id => {
		setToasts(prev => prev.filter(item => item.id !== id))
	}, [])

	const fetchNewToastItems = useCallback(async afterId => {
		try {
			const params = new URLSearchParams({
				limit: String(MAX_NEW_ITEMS_PER_POLL),
				after_id: String(afterId),
			})

			const res = await fetch(
				`${API_BASE_URL}/portal/notifications?${params}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) return []

			const data = await res.json()
			const items = Array.isArray(data.items) ? data.items : []

			// Какие события всплывают, решает сервер полем is_toast.
			// Второй список важных типов на фронте рано или поздно
			// разошёлся бы с первым.
			return items.filter(item => item.is_toast)
		} catch {
			return []
		}
	}, [])

	const refresh = useCallback(async () => {
		if (!isEnabled) return
		if (isFetchingRef.current) return

		isFetchingRef.current = true

		try {
			const res = await fetch(`${API_BASE_URL}/portal/notifications/summary`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) return

			const data = await res.json()

			const nextUnreadCount = Number(data.unread_count || 0)
			const latestId = Number(data.latest_id || 0)

			const byRequest = {}

			for (const row of Array.isArray(data.requests) ? data.requests : []) {
				byRequest[String(row.request_id)] = {
					unreadCount: Number(row.unread_count || 0),
					lastTitle: row.last_title,
					lastMessage: row.last_message,
					lastCreatedAt: row.last_created_at,
				}
			}

			setUnreadCount(nextUnreadCount)
			setUnreadByRequest(byRequest)

			const previousId = lastSeenIdRef.current

			if (previousId === null) {
				lastSeenIdRef.current = latestId
				return
			}

			if (latestId > previousId) {
				const newToasts = await fetchNewToastItems(previousId)

				lastSeenIdRef.current = latestId

				if (newToasts.length > 0) {
					setToasts(prev => [...newToasts, ...prev].slice(0, MAX_TOASTS))
				}

				// Появилось новое — открытые вкладки должны перечитать
				// свои данные. Сигнал общий: что именно поменялось,
				// вкладка узнает из своего же запроса.
				setRevision(value => value + 1)
			}
		} catch (err) {
			// Обрыв связи не должен ронять кабинет: следующий обход
			// через полминуты подберёт всё, что накопилось.
			console.error('Не удалось получить уведомления:', err)
		} finally {
			isFetchingRef.current = false
		}
	}, [isEnabled, fetchNewToastItems])

	const markRequestRead = useCallback(
		async requestId => {
			if (!isEnabled || !requestId) return

			try {
				await fetch(
					`${API_BASE_URL}/portal/notifications/requests/${requestId}/read`,
					{ method: 'PATCH', headers: getAuthHeaders() },
				)
			} catch (err) {
				console.error('Не удалось отметить уведомления прочитанными:', err)
			}

			// Подсветку в списке снимаем сразу, не дожидаясь ответа сервера:
			// клиент карточку уже открыл.
			setUnreadByRequest(prev => {
				const next = { ...prev }
				const removed = next[String(requestId)]

				delete next[String(requestId)]

				if (removed) {
					setUnreadCount(value => Math.max(0, value - removed.unreadCount))
				}

				return next
			})
		},
		[isEnabled],
	)

	const markAllRead = useCallback(async () => {
		if (!isEnabled) return

		try {
			await fetch(`${API_BASE_URL}/portal/notifications/read-all`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})
		} catch (err) {
			console.error('Не удалось отметить уведомления прочитанными:', err)
		}

		setUnreadCount(0)
		setUnreadByRequest({})
	}, [isEnabled])

	useEffect(() => {
		if (!isEnabled) return

		refresh()

		const intervalId = setInterval(() => {
			// Во вкладке, которую не смотрят, опрашивать незачем.
			// При возврате фокуса обход происходит сразу.
			if (document.hidden) return

			refresh()
		}, POLL_INTERVAL_MS)

		const handleFocus = () => refresh()

		window.addEventListener('focus', handleFocus)

		return () => {
			clearInterval(intervalId)
			window.removeEventListener('focus', handleFocus)
		}
	}, [isEnabled, refresh])

	useEffect(() => {
		if (toasts.length === 0) return

		const timeoutId = setTimeout(() => {
			setToasts(prev => prev.slice(0, prev.length - 1))
		}, TOAST_LIFETIME_MS)

		return () => clearTimeout(timeoutId)
	}, [toasts])

	const handleToastOpen = useCallback(
		item => {
			dismissToast(item.id)

			if (!item.request_id) return

			navigate('/portal/requests', {
				state: {
					openRequestId: item.request_id,
					portalActionId: `${Date.now()}-${Math.random()}`,
				},
			})
		},
		[dismissToast, navigate],
	)

	const value = {
		unreadCount,
		unreadByRequest,
		revision,
		refresh,
		markRequestRead,
		markAllRead,
	}

	return (
		<PortalNotificationsContext.Provider value={value}>
			{children}

			<PortalToasts
				items={toasts}
				onDismiss={dismissToast}
				onOpen={handleToastOpen}
			/>
		</PortalNotificationsContext.Provider>
	)
}

export { formatDateTime as formatPortalNotificationDate }
