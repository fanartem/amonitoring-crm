import React from 'react'
import StatusBadge from './StatusBadge'

export default function DashboardTable({ requests, onRowClick }) {
	if (!requests || requests.length === 0) {
		return (
			<div className='dash-table-wrap'>
				<div className='dash-empty visible'>Нет заявок</div>
			</div>
		)
	}

	return (
		<div className='dash-table-wrap'>
			<table className='dash-table'>
				<thead>
					<tr>
						<th>Клиент</th>
						<th>Тип работ</th>
						<th>Дата создания</th>
						<th>Статус</th>
					</tr>
				</thead>
				<tbody>
					{requests.map(req => (
						<tr key={req.id} onClick={() => onRowClick(req.id)}>
							<td>{req.client_name || '—'}</td>
							<td>{req.work_type}</td>
							<td>{new Date(req.created_at).toLocaleDateString('ru-RU')}</td>
							<td>
								<StatusBadge status={req.status} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
