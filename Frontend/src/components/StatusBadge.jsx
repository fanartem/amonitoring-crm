import React from 'react'

const statusConfig = {
	NEW: { text: 'В ожидании', className: 'st-waiting' },
	IN_PROGRESS: { text: 'В процессе', className: 'st-process' },
	DONE: { text: 'Завершено', className: 'st-done' },
	CANCELLED: { text: 'Отмена', className: 'st-cancelled' },
}

export default function StatusBadge({ status }) {
	const config = statusConfig[status] || {
		text: status,
		className: 'st-waiting',
	}

	return <span className={`st-badge ${config.className}`}>{config.text}</span>
}
