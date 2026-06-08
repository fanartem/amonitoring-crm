import React, { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/AttachmentsPanel.css'

const formatFileSize = bytes => {
	const size = Number(bytes || 0)

	if (size < 1024) return `${size} Б`
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`

	return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

const formatDateTime = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleString('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return value
	}
}

const getUserRole = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null

		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
				.join(''),
		)

		return JSON.parse(jsonPayload).role
	} catch {
		return null
	}
}

export default function AttachmentsPanel({ entityType, entityId }) {
	const fileInputRef = useRef(null)

	const [attachments, setAttachments] = useState([])
	const [loading, setLoading] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [error, setError] = useState('')

	const [editingId, setEditingId] = useState(null)
	const [editingName, setEditingName] = useState('')

	const normalizedEntityType = String(entityType || '').toUpperCase()

	const userRole = getUserRole()

	const isAttachmentRestrictedUser =
		userRole === 'TECHNICIAN' || userRole === 'SENIOR_TECHNICIAN'

	useEffect(() => {
		if (!normalizedEntityType || !entityId) return

		fetchAttachments()
	}, [normalizedEntityType, entityId])

	const fetchAttachments = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/entity/${normalizedEntityType}/${entityId}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить файлы')
			}

			const data = await res.json()
			setAttachments(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleFileSelect = async e => {
		const file = e.target.files[0]

		if (!file) return

		const formData = new FormData()
		formData.append('file', file)

		setUploading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/entity/${normalizedEntityType}/${entityId}`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
					body: formData,
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось загрузить файл')
			}

			await fetchAttachments()
		} catch (err) {
			setError(err.message)
		} finally {
			setUploading(false)
			e.target.value = ''
		}
	}

	const startEdit = attachment => {
		setEditingId(attachment.id)
		setEditingName(
			attachment.display_name || attachment.original_filename || '',
		)
		setError('')
	}

	const cancelEdit = () => {
		setEditingId(null)
		setEditingName('')
	}

	const saveEdit = async attachmentId => {
		const nextName = editingName.trim()

		if (!nextName) {
			setError('Название файла не может быть пустым')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/attachments/${attachmentId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					display_name: nextName,
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось переименовать файл')
			}

			setAttachments(prev =>
				prev.map(item =>
					item.id === attachmentId
						? {
								...item,
								display_name: nextName,
							}
						: item,
				),
			)

			cancelEdit()
		} catch (err) {
			setError(err.message)
		}
	}

	const deleteAttachment = async attachment => {
		if (
			!window.confirm(
				`Удалить файл "${attachment.display_name || attachment.original_filename}"?`,
			)
		) {
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/attachments/${attachment.id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось удалить файл')
			}

			setAttachments(prev => prev.filter(item => item.id !== attachment.id))
		} catch (err) {
			setError(err.message)
		}
	}

	const downloadAttachment = async attachment => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/${attachment.id}/download`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось скачать файл')
			}

			const blob = await res.blob()
			const url = window.URL.createObjectURL(blob)
			const link = document.createElement('a')

			link.href = url
			link.download = attachment.display_name || attachment.original_filename
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			window.URL.revokeObjectURL(url)
		} catch (err) {
			setError(err.message)
		}
	}

	return (
		<div className='attachments-panel'>
			<div className='attachments-panel-header'>
				<div>
					<h3>Прикрепленные файлы</h3>
					<p>
						{isAttachmentRestrictedUser
							? 'Вы видите только файлы, загруженные вами.'
							: 'Документы, фото, чеки и другие файлы по этому объекту.'}
					</p>
				</div>

				<div>
					<input
						ref={fileInputRef}
						type='file'
						style={{ display: 'none' }}
						onChange={handleFileSelect}
						accept='.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'
					/>

					<button
						type='button'
						className='attachments-add-btn'
						onClick={() => fileInputRef.current?.click()}
						disabled={uploading}
					>
						{uploading ? 'Загрузка...' : '+ Добавить файл'}
					</button>
				</div>
			</div>

			{error && <div className='attachments-error'>{error}</div>}

			{loading ? (
				<div className='attachments-empty'>Загрузка файлов...</div>
			) : attachments.length === 0 ? (
				<div className='attachments-empty'>
					{isAttachmentRestrictedUser
						? 'У вас пока нет загруженных файлов по этому объекту.'
						: 'Файлы пока не прикреплены'}
				</div>
			) : (
				<div className='attachments-list'>
					{attachments.map(file => (
						<div key={file.id} className='attachments-item'>
							<div className='attachments-file-icon'>📎</div>

							<div className='attachments-file-main'>
								{editingId === file.id ? (
									<div className='attachments-edit-row'>
										<input
											className='attachments-edit-input'
											value={editingName}
											onChange={e => setEditingName(e.target.value)}
											autoFocus
										/>

										<button
											type='button'
											className='attachments-save-btn'
											onClick={() => saveEdit(file.id)}
										>
											Сохранить
										</button>

										<button
											type='button'
											className='attachments-cancel-btn'
											onClick={cancelEdit}
										>
											Отмена
										</button>
									</div>
								) : (
									<>
										<div className='attachments-file-title'>
											{file.display_name || file.original_filename}
										</div>

										<div className='attachments-file-meta'>
											<span>{formatFileSize(file.file_size)}</span>
											<span>•</span>
											<span>
												Загрузил:{' '}
												{file.uploaded_by_name ||
													`ID ${file.uploaded_by || '—'}`}
											</span>
											<span>•</span>
											<span>{formatDateTime(file.uploaded_at)}</span>
										</div>

										{file.original_filename &&
											file.original_filename !== file.display_name && (
												<div className='attachments-original-name'>
													Исходное имя: {file.original_filename}
												</div>
											)}
									</>
								)}
							</div>

							{editingId !== file.id && (
								<div className='attachments-actions'>
									<button
										type='button'
										className='attachments-action-btn'
										onClick={() => downloadAttachment(file)}
										title='Скачать'
									>
										⬇
									</button>

									<button
										type='button'
										className='attachments-action-btn'
										onClick={() => startEdit(file)}
										title='Переименовать'
									>
										✎
									</button>

									<button
										type='button'
										className='attachments-action-btn danger'
										onClick={() => deleteAttachment(file)}
										title='Удалить'
									>
										🗑
									</button>
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
