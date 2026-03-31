import React from 'react'

// Маппинг статусов БД -> текст и стиль фронтенда
const statusConfig = {
	NEW: { text: 'В ожидании', className: 'st-waiting' },
	IN_PROGRESS: { text: 'В процессе', className: 'st-process' },
	DONE: { text: 'Завершено', className: 'st-done' },
	// Статус 'Cancelled' в твоем бэкенде пока нет, но у коллеги есть.
	// Добавим для совместимости верстки.
	CANCELLED: { text: 'Отмена', className: 'st-cancelled' },
}

export default function StatusBadge({ status }) {
	// Берем конфиг для статуса, или дефолт, если статус неизвестен
	const config = statusConfig[status] || {
		text: status,
		className: 'st-waiting',
	}

	return <span className={`st-badge ${config.className}`}>{config.text}</span>
}
