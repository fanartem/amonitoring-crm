import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import '../../styles/Notifications.css'

const STORAGE_KEY = 'crm_new_request_notice'
const EVENT_NAME = 'crm:new-request-created'
const DEFAULT_TTL_SECONDS = 120

const getDefaultMessage = requestId => {
	if (requestId) {
		return `Заявка №${requestId} создана. У вас есть 2 минуты, чтобы проверить её и при необходимости удалить.`
	}

	return 'Заявка создана. У вас есть 2 минуты, чтобы проверить её и при необходимости удалить.'
}

const readStoredNotice = () => {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)

		if (!raw) return null

		const notice = JSON.parse(raw)

		if (!notice?.expiresAt || Date.now() >= Number(notice.expiresAt)) {
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

	const notice = {
		id: `${now}-${normalizedRequestId || 'request'}`,
		requestId: normalizedRequestId,
		message: message || getDefaultMessage(normalizedRequestId),
		createdAt: now,
		expiresAt: now + Number(expiresInSeconds || DEFAULT_TTL_SECONDS) * 1000,
		ttlSeconds: Number(expiresInSeconds || DEFAULT_TTL_SECONDS),
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
