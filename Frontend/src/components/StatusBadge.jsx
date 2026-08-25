import React from 'react'

const statusConfig = {
	NEW: { text: 'В ожидании', className: 'st-waiting' },
	IN_PROGRESS: { text: 'Принято в работу', className: 'st-process' },
	COMPLETED: { text: 'Работы завершены', className: 'st-done' },
	DONE: { text: 'Работы завершены', className: 'st-done' },
	CANCELLED: { text: 'Отменено', className: 'st-cancelled' },
}

export default function StatusBadge({ status }) {
	const normalizedStatus = String(status || '').toUpperCase()

	const config = statusConfig[normalizedStatus] || {
		text: status || '—',
		className: 'st-waiting',
	}

	return <span className={`st-badge ${config.className}`}>{config.text}</span>
}
