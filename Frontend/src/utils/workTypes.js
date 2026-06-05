export const WORK_TYPE_LABELS = {
	INSTALLATION: 'Установка',
	REMOVAL: 'Снятие',
	DIAGNOSTIC: 'Диагностика',
	REFLASHING: 'Перепрошивка',
}

export const WORK_TYPE_COLORS = {
	INSTALLATION: '#1565c0',
	REMOVAL: '#c62828',
	DIAGNOSTIC: '#e65100',
	REFLASHING: '#6a1b9a',
}

export const WORK_TYPE_CLASSES = {
	INSTALLATION: 'work-type-installation',
	REMOVAL: 'work-type-removal',
	DIAGNOSTIC: 'work-type-diagnostic',
	REFLASHING: 'work-type-reflashing',
}

export const getWorkTypeLabel = workType => {
	return WORK_TYPE_LABELS[workType] || workType || '—'
}

export const getWorkTypeColor = workType => {
	return WORK_TYPE_COLORS[workType] || '#333333'
}

export const getWorkTypeClass = workType => {
	return WORK_TYPE_CLASSES[workType] || 'work-type-default'
}
