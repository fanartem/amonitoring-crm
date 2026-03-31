import React from 'react'
import StatusBadge from './StatusBadge'

// Маппинг для типов и форматов работ
const workTypeLabels = {
	INSTALLATION: 'Установка',
	DIAGNOSTIC: 'Диагностика',
	REMOVAL: 'Снятие',
}
const visitTypeLabels = { IN_OFFICE: 'В офисе', ON_SITE: 'Выезд' }

export default function RequestCard({ request, onClick }) {
	return (
		<div className='request-card' onClick={() => onClick(request.id)}>
			<div className='card-row'>
				<span className='card-label'>Клиент</span>
				<span className='card-value'>{request.client_name || '—'}</span>
			</div>
			<div className='card-row'>
				<span className='card-label'>Телефон</span>
				<span className='card-value'>{request.phone || '—'}</span>
			</div>
			<div className='card-row'>
				<span className='card-label'>Тип работ</span>
				<span className='card-value'>
					{workTypeLabels[request.work_type] || request.work_type}
				</span>
			</div>
			<div className='card-row'>
				<span className='card-label'>Статус</span>
				<div style={{ fontSize: '11px' }}>
					<StatusBadge status={request.status} />
				</div>
			</div>
			<div className='card-row'>
				<span className='card-label'>Автомобиль</span>
				<span className='card-value'>
					{request.brand} {request.model} ({request.plate_number})
				</span>
			</div>
			<div className='card-row'>
				<span className='card-label'>Формат</span>
				<span className='card-value'>
					{visitTypeLabels[request.visit_type] || request.visit_type}
				</span>
			</div>
		</div>
	)
}
