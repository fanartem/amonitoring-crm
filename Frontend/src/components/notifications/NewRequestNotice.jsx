import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { getStoredUser, hasAnyPermission } from '../../utils/access'
import '../../styles/Notifications.css'

const STORAGE_KEY = 'crm_new_request_notice'
const EVENT_NAME = 'crm:new-request-created'
// Запасное значение. Настоящее окно приходит с сервера
// в поле delete_window_seconds_left (см. requests.py).
const DEFAULT_TTL_SECONDS = 120

const canDeleteOwnRequest = () =>
	hasAnyPermission(getStoredUser(), [
		'requests.delete_own_limited',
		'requests.delete_any',
	])

const formatMinutes = totalSeconds => {
	const minutes = Math.max(1, Math.round(Number(totalSeconds) / 60))
	const lastTwoDigits = minutes % 100
	const lastDigit = minutes % 10

	if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${minutes} минут`
	if (lastDigit === 1) return `${minutes} минуту`
	if (lastDigit >= 2 && lastDigit <= 4) return `${minutes} минуты`

	return `${minutes} минут`
}

const getDefaultMessage = (requestId, ttlSeconds) => {
	const requestPart = requestId
		? `Заявка №${requestId} создана.`
		: 'Заявка создана.'

	// Обещать удаление можно только тому, у кого есть право удалять.
	if (!canDeleteOwnRequest()) {
		return `${requestPart} Проверьте данные — если нашли ошибку, обратитесь к руководителю.`
	}

	return `${requestPart} У вас есть ${formatMinutes(
		ttlSeconds,
	)}, чтобы проверить её и при необходимости удалить.`
}

const readStoredNotice = () => {
	try {
		const currentUserId = getStoredUser()?.id

		// Нет вошедшего пользователя — плашке неоткуда взяться
		// (в том числе на экране входа).
		if (!currentUserId) {
			return null
		}

		const raw = sessionStorage.getItem(STORAGE_KEY)

		if (!raw) return null

		const notice = JSON.parse(raw)

		if (!notice?.expiresAt || Date.now() >= Number(notice.expiresAt)) {
			sessionStorage.removeItem(STORAGE_KEY)
			return null
		}

		// sessionStorage живёт на вкладку, а не на сессию входа:
		// без этой проверки следующий вошедший увидит чужую заявку.
		if (Number(notice.userId) !== Number(currentUserId)) {
			sessionStorage.removeItem(STORAGE_KEY)
			return null
		}

		return notice
	} catch {
		return null
	}
}

const saveNotice = notice => {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notice))
	} catch {
		// ignore
	}
}

const clearStoredNotice = () => {
	try {
		sessionStorage.removeItem(STORAGE_KEY)
	} catch {
		// ignore
	}
}

export const notifyNewRequestCreated = ({
	requestId,
	message,
	expiresInSeconds = DEFAULT_TTL_SECONDS,
} = {}) => {
	const now = Date.now()
	const normalizedRequestId = requestId ? Number(requestId) : null
	const normalizedTtlSeconds = Number(expiresInSeconds || DEFAULT_TTL_SECONDS)

	const notice = {
		id: `${now}-${normalizedRequestId || 'request'}`,
		requestId: normalizedRequestId,
		userId: getStoredUser()?.id ?? null,
		message:
			message || getDefaultMessage(normalizedRequestId, normalizedTtlSeconds),
		createdAt: now,
		expiresAt: now + normalizedTtlSeconds * 1000,
		ttlSeconds: normalizedTtlSeconds,
	}

	saveNotice(notice)

	window.dispatchEvent(
		new CustomEvent(EVENT_NAME, {
			detail: notice,
		}),
	)
}

export default function NewRequestNotice() {
	const navigate = useNavigate()

	const [notice, setNotice] = useState(() => readStoredNotice())
	const [nowMs, setNowMs] = useState(Date.now())

	useEffect(() => {
		const handleNotice = event => {
			if (!event.detail) return

			setNotice(event.detail)
			setNowMs(Date.now())
		}

		window.addEventListener(EVENT_NAME, handleNotice)

		return () => {
			window.removeEventListener(EVENT_NAME, handleNotice)
		}
	}, [])

	useEffect(() => {
		if (!notice) return

		const intervalId = setInterval(() => {
			const currentTime = Date.now()

			setNowMs(currentTime)

			if (currentTime >= Number(notice.expiresAt || 0)) {
				clearStoredNotice()
				setNotice(null)
			}
		}, 1000)

		return () => clearInterval(intervalId)
	}, [notice])

	const secondsLeft = useMemo(() => {
		if (!notice?.expiresAt) return 0

		return Math.max(
			0,
			Math.ceil((Number(notice.expiresAt) - Number(nowMs)) / 1000),
		)
	}, [notice, nowMs])

	const formattedSecondsLeft = useMemo(() => {
		const minutes = Math.floor(secondsLeft / 60)
		const seconds = secondsLeft % 60

		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
			2,
			'0',
		)}`
	}, [secondsLeft])

	const progressDegrees = useMemo(() => {
		const ttlSeconds = Number(notice?.ttlSeconds || DEFAULT_TTL_SECONDS)

		if (!ttlSeconds) return 0

		return Math.max(0, Math.min(360, (secondsLeft / ttlSeconds) * 360))
	}, [notice, secondsLeft])

	if (!notice) return null

	const handleOpenRequest = () => {
		if (notice.requestId) {
			navigate('/requests', {
				state: {
					openRequestId: Number(notice.requestId),
					searchActionId: Date.now(),
				},
			})
		} else {
			navigate('/requests')
		}
	}

	const handleClose = () => {
		clearStoredNotice()
		setNotice(null)
	}

	return (
		<div className='new-request-notice-root'>
			<div
				className='new-request-notice-card'
				style={{
					'--notice-progress': `${progressDegrees}deg`,
				}}
			>
				<div className='new-request-notice-icon'>✓</div>

				<div className='new-request-notice-content'>
					<div className='new-request-notice-title'>Новая заявка создана</div>
					<div className='new-request-notice-text'>{notice.message}</div>

					<div className='new-request-notice-actions'>
						<button
							type='button'
							className='new-request-notice-open'
							onClick={handleOpenRequest}
						>
							Открыть заявку
						</button>

						<button
							type='button'
							className='new-request-notice-close'
							onClick={handleClose}
						>
							Скрыть
						</button>
					</div>
				</div>

				<div className='new-request-notice-timer'>
					<span>{formattedSecondsLeft}</span>
				</div>
			</div>
		</div>
	)
}
