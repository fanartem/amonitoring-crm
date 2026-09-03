import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../../api'
import { canViewPortalSubclients, getStoredUser } from '../../utils/access'
import { usePortalDataRevision } from './PortalNotificationsContext'

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 400

const getVehicleTitle = vehicle =>
	`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() || 'Автомобиль'

export default function PortalVehicles() {
	const location = useLocation()
	const revision = usePortalDataRevision()
	const currentUser = getStoredUser()
	const canSeeSubclients = canViewPortalSubclients(currentUser)

	const [clients, setClients] = useState([])
	const [ownClientId, setOwnClientId] = useState(null)

	const [items, setItems] = useState([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])

	// Переход со вкладки «Подклиенты» приносит организацию с собой.
	// Тот же приём, что в CRM: Header передаёт клиента в Clients.jsx
	// через состояние навигации.
	const [clientFilter, setClientFilter] = useState(
		location.state?.portalClientId ? String(location.state.portalClientId) : '',
	)
	const [searchInput, setSearchInput] = useState('')
	const [search, setSearch] = useState('')

	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const totalPages = Math.max(1, Math.ceil(total / pageSize))

	// Поиск уходит на сервер, поэтому не дёргаем его на каждую букву.
	useEffect(() => {
		const timeout = setTimeout(() => {
			const value = searchInput.trim()

			setSearch(value.length >= MIN_SEARCH_LENGTH ? value : '')
			setPage(1)
		}, SEARCH_DEBOUNCE_MS)

		return () => clearTimeout(timeout)
	}, [searchInput])

	useEffect(() => {
		fetchClients()
	}, [])

	useEffect(() => {
		fetchVehicles()
	}, [clientFilter, search, page, pageSize, revision])

	const readError = async (res, fallback) => {
		const data = await res.json().catch(() => null)
		return data?.detail || fallback
	}

	const fetchClients = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/portal/clients`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) return

			const data = await res.json()

			setClients(Array.isArray(data.items) ? data.items : [])
			setOwnClientId(data.own_client_id ?? null)
		} catch (err) {
			// Фильтр по организациям — удобство, а не необходимость.
			// Список машин грузится независимо.
			console.error('Не удалось загрузить список организаций:', err)
		}
	}

	const fetchVehicles = async () => {
		setLoading(true)
		setError('')

		try {
			const params = new URLSearchParams({
				limit: String(pageSize),
				offset: String((page - 1) * pageSize),
			})

			if (clientFilter) params.set('client_id', clientFilter)
			if (search) params.set('q', search)

			const res = await fetch(`${API_BASE_URL}/portal/vehicles?${params}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось загрузить машины'))
			}

			const data = await res.json()

			setItems(Array.isArray(data.items) ? data.items : [])
			setTotal(Number(data.total || 0))
		} catch (err) {
			setError(err.message)
			setItems([])
			setTotal(0)
		} finally {
			setLoading(false)
		}
	}

	// Фильтр по организациям показываем, только если их правда несколько.
	const showClientFilter = useMemo(
		() => canSeeSubclients && clients.length > 1,
		[canSeeSubclients, clients.length],
	)

	return (
		<div className='portal-veh-page'>
			<style>{`
				.portal-veh-page {
					padding: 24px 20px 40px;
				}

				.portal-veh-page h2 {
					margin: 0 0 4px;
					font-size: 20px;
					color: #222;
				}

				.portal-veh-subtitle {
					font-size: 13px;
					color: #777;
					margin-bottom: 18px;
				}

				.portal-veh-toolbar {
					display: flex;
					gap: 10px;
					flex-wrap: wrap;
					align-items: center;
					margin-bottom: 16px;
				}

				.portal-veh-input {
					border: 1px solid #ddd;
					border-radius: 6px;
					padding: 8px 11px;
					font-size: 14px;
					box-sizing: border-box;
					background: #fff;
				}

				.portal-veh-search {
					min-width: 240px;
					flex: 1 1 240px;
				}

				.portal-veh-card {
					background: #fff;
					border: 1px solid #e6e6e6;
					border-radius: 10px;
					padding: 13px 16px;
					margin-bottom: 9px;
				}

				.portal-veh-card.subclient {
					border-left: 3px solid #1e4b9c;
				}

				.portal-veh-card-top {
					display: flex;
					justify-content: space-between;
					gap: 12px;
					flex-wrap: wrap;
					align-items: baseline;
				}

				.portal-veh-title {
					font-size: 15px;
					font-weight: 700;
					color: #222;
				}

				.portal-veh-plate {
					display: inline-block;
					margin-left: 8px;
					font-size: 13px;
					font-weight: 600;
					color: #444;
					background: #f2f4f6;
					border: 1px solid #e2e6ea;
					border-radius: 6px;
					padding: 1px 8px;
				}

				.portal-veh-org {
					font-size: 11px;
					font-weight: 700;
					padding: 2px 9px;
					border-radius: 10px;
					background: #eef4ff;
					color: #1e4b9c;
					border: 1px solid #cfe0ff;
					white-space: nowrap;
				}

				.portal-veh-meta {
					font-size: 13px;
					color: #666;
					margin-top: 6px;
					line-height: 1.55;
				}

				.portal-veh-vin {
					font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
					font-size: 12.5px;
					color: #444;
				}

				.portal-veh-banner {
					padding: 10px 12px;
					border-radius: 8px;
					font-size: 13px;
					line-height: 1.45;
					margin-bottom: 14px;
				}

				.portal-veh-banner.error {
					background: #fdecea;
					border: 1px solid #f5c6cb;
					color: #b71c1c;
				}

				.portal-veh-empty {
					padding: 30px 0;
					text-align: center;
					color: #888;
					font-size: 14px;
				}

				.portal-veh-pagination {
					display: flex;
					justify-content: space-between;
					align-items: center;
					gap: 12px;
					flex-wrap: wrap;
					margin-top: 16px;
					font-size: 13px;
					color: #666;
				}

				.portal-veh-btn {
					border: 1px solid #ddd;
					background: #fff;
					border-radius: 6px;
					padding: 7px 14px;
					font-size: 13px;
					color: #444;
					cursor: pointer;
				}

				.portal-veh-btn:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}
			`}</style>

			<h2>Автомобили</h2>
			<div className='portal-veh-subtitle'>
				{canSeeSubclients
					? 'Автомобили вашей организации и организаций в вашей структуре.'
					: 'Автомобили вашей организации.'}
			</div>

			{error && <div className='portal-veh-banner error'>{error}</div>}

			<div className='portal-veh-toolbar'>
				{showClientFilter && (
					<select
						className='portal-veh-input'
						value={clientFilter}
						onChange={e => {
							setClientFilter(e.target.value)
							setPage(1)
						}}
					>
						<option value=''>Все организации</option>

						{clients.map(client => (
							<option key={client.id} value={client.id}>
								{client.name}
								{client.is_own ? ' — высшая организация' : ''}
								{` (${client.vehicle_count})`}
							</option>
						))}
					</select>
				)}

				<input
					className='portal-veh-input portal-veh-search'
					value={searchInput}
					onChange={e => setSearchInput(e.target.value)}
					placeholder='Марка, модель, госномер, VIN...'
				/>

				<select
					className='portal-veh-input'
					value={pageSize}
					onChange={e => {
						setPageSize(Number(e.target.value))
						setPage(1)
					}}
				>
					{PAGE_SIZE_OPTIONS.map(size => (
						<option key={size} value={size}>
							по {size}
						</option>
					))}
				</select>
			</div>

			{loading ? (
				<div className='portal-veh-empty'>Загрузка машин...</div>
			) : items.length === 0 ? (
				<div className='portal-veh-empty'>
					{search || clientFilter
						? 'По выбранным условиям ничего не найдено'
						: 'Машин пока нет'}
				</div>
			) : (
				<>
					{items.map(vehicle => (
						<div
							key={vehicle.id}
							className={`portal-veh-card ${vehicle.is_own_client ? '' : 'subclient'}`}
						>
							<div className='portal-veh-card-top'>
								<div>
									<span className='portal-veh-title'>
										{getVehicleTitle(vehicle)}
									</span>

									<span className='portal-veh-plate'>
										{vehicle.plate_number || 'б/н'}
									</span>
								</div>

								{!vehicle.is_own_client && vehicle.client_name && (
									<span className='portal-veh-org'>{vehicle.client_name}</span>
								)}
							</div>

							<div className='portal-veh-meta'>
								<span className='portal-veh-vin'>
									VIN: {vehicle.vin || '—'}
								</span>
								{vehicle.year ? ` · ${vehicle.year} г.` : ''}
								{vehicle.type ? ` · ${vehicle.type}` : ''}
							</div>
						</div>
					))}

					<div className='portal-veh-pagination'>
						<span>
							Страница {page} из {totalPages} · Всего: {total}
						</span>

						<span style={{ display: 'flex', gap: 8 }}>
							<button
								type='button'
								className='portal-veh-btn'
								disabled={page <= 1}
								onClick={() => setPage(prev => Math.max(1, prev - 1))}
							>
								Назад
							</button>

							<button
								type='button'
								className='portal-veh-btn'
								disabled={page >= totalPages}
								onClick={() => setPage(prev => prev + 1)}
							>
								Вперёд
							</button>
						</span>
					</div>
				</>
			)}
		</div>
	)
}
