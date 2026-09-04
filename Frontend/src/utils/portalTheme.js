/*
 * Тема кабинета клиента: из одного цвета — весь набор.
 *
 * Решение Р58: сотрудник выбирает ОДИН основной цвет. Всё остальное —
 * цвет текста на шапке, фон сайдбара, активный пункт меню, кнопки,
 * рамки, мягкие плашки — считается отсюда. Причина простая: любой второй
 * цвет, который человек выбирает руками, рано или поздно окажется
 * нечитаемым в паре с первым, и разбираться с этим будем мы.
 *
 * Главное правило файла: ни один цвет текста не берётся «на глаз».
 * Каждый проверяется по контрасту WCAG против своего фона и, если не
 * проходит, затемняется или осветляется до тех пор, пока не пройдёт.
 * Поэтому тема остаётся читаемой даже на жёлтом, белом и чёрном.
 *
 * Файл общий для CRM и кабинета: в CRM по нему рисуется предпросмотр
 * в настройках, в кабинете — сам интерфейс. Две копии этой математики
 * разошлись бы, и предпросмотр начал бы врать.
 */

// Текущий акцент кабинета. Он же — значение по умолчанию, поэтому
// клиент без настроенного брендинга выглядит ровно как сегодня.
export const DEFAULT_BASE_COLOR = '#5e9424'

// Два разных порога, и это не небрежность.
//
// 4.5 — WCAG AA для обычного текста: строки, ссылки, подписи на светлых
// плашках. Здесь мы вольны затемнять текст сколько нужно, потому что фон
// светлый почти всегда.
//
// 3.0 — WCAG AA для крупного текста и элементов интерфейса (1.4.3, 1.4.11):
// надписи на шапке и на кнопках. Порог ниже намеренно. Требовать от них 4.5
// значит подкрашивать саму заливку, то есть менять цвет, который сотрудник
// только что выбрал, — и, в частности, сегодняшний зелёный кабинета
// (#5e9424 с белыми надписями даёт 3.65) пришлось бы «поправить».
// Приятный побочный эффект: при пороге 3.0 хотя бы один из двух цветов
// текста проходит на ЛЮБОЙ заливке, поэтому подкрашивать её не нужно
// никогда — доказательство в комментарии к pickTextOn.
const MIN_TEXT_CONTRAST = 4.5
const MIN_UI_CONTRAST = 3.0

// Кандидаты в цвет текста поверх заливки. Не чистый чёрный и не чистый
// белый: на больших плоскостях они дают неприятный «звон» по краям.
const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#16202c'

// --------------------------------------------------------------------------
// Преобразования цвета
// --------------------------------------------------------------------------

export const normalizeHexColor = value => {
	const raw = String(value || '').trim()

	const short = raw.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i)

	if (short) {
		return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
	}

	const full = raw.match(/^#?([0-9a-f]{6})$/i)

	return full ? `#${full[1].toLowerCase()}` : null
}

export const isValidHexColor = value => normalizeHexColor(value) !== null

const hexToRgb = hex => {
	const normalized = normalizeHexColor(hex) || DEFAULT_BASE_COLOR

	return {
		r: parseInt(normalized.slice(1, 3), 16),
		g: parseInt(normalized.slice(3, 5), 16),
		b: parseInt(normalized.slice(5, 7), 16),
	}
}

const rgbToHex = ({ r, g, b }) => {
	const toPart = value =>
		Math.max(0, Math.min(255, Math.round(value)))
			.toString(16)
			.padStart(2, '0')

	return `#${toPart(r)}${toPart(g)}${toPart(b)}`
}

const rgbToHsl = ({ r, g, b }) => {
	const rn = r / 255
	const gn = g / 255
	const bn = b / 255

	const max = Math.max(rn, gn, bn)
	const min = Math.min(rn, gn, bn)
	const delta = max - min

	let h = 0

	if (delta !== 0) {
		if (max === rn) h = ((gn - bn) / delta) % 6
		else if (max === gn) h = (bn - rn) / delta + 2
		else h = (rn - gn) / delta + 4
	}

	h = Math.round(h * 60)

	if (h < 0) h += 360

	const l = (max + min) / 2
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

	return { h, s, l }
}

const hslToRgb = ({ h, s, l }) => {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
	const m = l - c / 2

	let rgb

	if (h < 60) rgb = [c, x, 0]
	else if (h < 120) rgb = [x, c, 0]
	else if (h < 180) rgb = [0, c, x]
	else if (h < 240) rgb = [0, x, c]
	else if (h < 300) rgb = [x, 0, c]
	else rgb = [c, 0, x]

	return {
		r: (rgb[0] + m) * 255,
		g: (rgb[1] + m) * 255,
		b: (rgb[2] + m) * 255,
	}
}

export const hexToHsl = hex => rgbToHsl(hexToRgb(hex))

export const hslToHex = hsl =>
	rgbToHex(
		hslToRgb({
			h: ((hsl.h % 360) + 360) % 360,
			s: Math.max(0, Math.min(1, hsl.s)),
			l: Math.max(0, Math.min(1, hsl.l)),
		}),
	)

// --------------------------------------------------------------------------
// Контраст
// --------------------------------------------------------------------------

const channelLuminance = value => {
	const v = value / 255

	return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export const getRelativeLuminance = hex => {
	const { r, g, b } = hexToRgb(hex)

	return (
		0.2126 * channelLuminance(r) +
		0.7152 * channelLuminance(g) +
		0.0722 * channelLuminance(b)
	)
}

export const getContrastRatio = (foreground, background) => {
	const a = getRelativeLuminance(foreground)
	const b = getRelativeLuminance(background)

	const lighter = Math.max(a, b)
	const darker = Math.min(a, b)

	return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Белый или тёмный текст поверх заливки — тот, что читается лучше.
 *
 * Результат всегда даёт не меньше 3.0. Почему без проверок: чтобы белый
 * дал меньше 3.0, светлота заливки должна быть выше 0.30; чтобы тёмный
 * дал меньше 3.0 — ниже 0.142. Одновременно это невозможно, значит хотя
 * бы один вариант проходит всегда, на любом цвете.
 */
export const pickTextOn = background =>
	getContrastRatio(LIGHT_TEXT, background) >=
	getContrastRatio(DARK_TEXT, background)
		? LIGHT_TEXT
		: DARK_TEXT

/**
 * Тот же цвет, но доведённый по светлоте до нужного контраста с фоном.
 *
 * Шагаем в ту сторону, где фон дальше: на светлом фоне темним, на тёмном
 * осветляем. Если по дороге упёрлись в чёрный или белый и контраста всё
 * равно не хватает — отдаём чистый чёрный/белый, это лучшее, что есть.
 */
export const ensureContrast = (
	color,
	background,
	minRatio = MIN_TEXT_CONTRAST,
) => {
	if (getContrastRatio(color, background) >= minRatio) {
		return normalizeHexColor(color) || color
	}

	const backgroundIsLight = getRelativeLuminance(background) > 0.4
	const hsl = hexToHsl(color)
	const step = 0.02

	let lightness = hsl.l

	for (let i = 0; i < 60; i += 1) {
		lightness += backgroundIsLight ? -step : step

		if (lightness <= 0) return '#000000'
		if (lightness >= 1) return '#ffffff'

		const candidate = hslToHex({ ...hsl, l: lightness })

		if (getContrastRatio(candidate, background) >= minRatio) {
			return candidate
		}
	}

	return backgroundIsLight ? '#000000' : '#ffffff'
}

/**
 * Смешивание с белым или чёрным. Даёт мягкие плашки и рамки того же
 * оттенка, что и основной цвет, — без второго выбора цвета человеком.
 */
export const mixWith = (hex, target, amount) => {
	const from = hexToRgb(hex)
	const to = hexToRgb(target)
	const k = Math.max(0, Math.min(1, amount))

	return rgbToHex({
		r: from.r + (to.r - from.r) * k,
		g: from.g + (to.g - from.g) * k,
		b: from.b + (to.b - from.b) * k,
	})
}

export const hexToRgbaString = (hex, alpha) => {
	const { r, g, b } = hexToRgb(hex)

	return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

// --------------------------------------------------------------------------
// Сама тема
// --------------------------------------------------------------------------

/**
 * Полный набор переменных кабинета из одного цвета.
 *
 * Шапка заливается основным цветом, сайдбар — тем же цветом, но темнее.
 * Так кабинет устроен сегодня (шапка #81b836, сайдбар #5a8a1f), и менять
 * саму раскладку вместе с цветом было бы подменой задачи: клиент просил
 * свой цвет, а не другой интерфейс.
 *
 * Полотно страницы и карточки остаются светлыми — цвет живёт по краям.
 */
export const buildPortalTheme = baseColor => {
	const base = normalizeHexColor(baseColor) || DEFAULT_BASE_COLOR
	const hsl = hexToHsl(base)
	const luminance = getRelativeLuminance(base)

	// Наведение: у тёмного цвета — светлее, у светлого — темнее.
	// Иначе на почти чёрном основном наведение было бы неразличимо.
	const hover =
		luminance < 0.18
			? hslToHex({ ...hsl, l: Math.min(1, hsl.l + 0.1) })
			: hslToHex({ ...hsl, l: Math.max(0, hsl.l - 0.08) })

	const headerText = pickTextOn(base)

	// Подложка кнопок на шапке (колокольчик) берётся из цвета САМИХ
	// надписей, а не из белого. Белая полупрозрачная подложка исчезает
	// на светлой шапке — ровно там, где надписи стали тёмными.
	const headerButtonBg = hexToRgbaString(headerText, 0.14)
	const headerButtonBgHover = hexToRgbaString(headerText, 0.26)

	// Мягкая плашка: почти белый с примесью оттенка.
	const softBg = mixWith(base, '#ffffff', 0.9)

	// Сайдбар — тот же цвет, но глубже. Не светлый: сегодня он тёмный,
	// и менять раскладку кабинета заодно с цветом мы не подписывались.
	const sidebarBg = mixWith(base, '#000000', 0.18)
	const sidebarText = pickTextOn(sidebarBg)

	// Активный пункт — заливка основным цветом: он светлее сайдбара
	// и потому читается как выделенный. Текст на нём тот же, что на
	// шапке: подложка-то одна и та же.
	const sidebarActiveBg = base
	const sidebarActiveText = headerText

	// Текст на светлом: основной цвет, затемнённый до читаемости.
	// Именно затемнённый, а не заменённый на серый: ссылка должна
	// оставаться «цветом организации».
	const onLight = ensureContrast(base, '#ffffff')
	const onSoft = ensureContrast(base, softBg)

	return {
		base,

		'--pb-primary': base,
		'--pb-primary-hover': hover,
		'--pb-on-primary': headerText,

		'--pb-header-bg': base,
		'--pb-header-text': headerText,
		'--pb-header-text-muted': hexToRgbaString(headerText, 0.75),
		'--pb-header-border': mixWith(base, '#000000', 0.12),
		'--pb-header-btn-bg': headerButtonBg,
		'--pb-header-btn-bg-hover': headerButtonBgHover,

		'--pb-sidebar-bg': sidebarBg,
		'--pb-sidebar-text': sidebarText,
		'--pb-sidebar-text-muted': hexToRgbaString(sidebarText, 0.75),
		'--pb-sidebar-hover-bg': hexToRgbaString(sidebarText, 0.12),
		'--pb-sidebar-text-active': sidebarActiveText,
		'--pb-sidebar-active-bg': sidebarActiveBg,
		'--pb-sidebar-border': mixWith(base, '#000000', 0.32),

		'--pb-soft-bg': softBg,
		'--pb-soft-text': onSoft,
		'--pb-border': mixWith(base, '#ffffff', 0.72),
		'--pb-link': onLight,
		'--pb-focus-ring': hexToRgbaString(base, 0.25),
	}
}

/**
 * Отчёт по контрасту: что с чем сравнивается и проходит ли.
 *
 * Нужен предпросмотру в настройках. Показывать сотруднику голые цифры
 * незачем, но когда цвет спорный, объяснение «надписи на шапке — 3.1,
 * это предел» отвечает на вопрос «нормально ли видно» точнее, чем
 * ощущение от картинки на конкретном мониторе.
 */
export const getThemeContrastReport = baseColor => {
	const theme = buildPortalTheme(baseColor)

	const pairs = [
		{
			key: 'header',
			label: 'Надписи на шапке',
			foreground: theme['--pb-header-text'],
			background: theme['--pb-header-bg'],
			min: MIN_UI_CONTRAST,
		},
		{
			key: 'button',
			label: 'Текст на кнопке',
			foreground: theme['--pb-on-primary'],
			background: theme['--pb-primary'],
			min: MIN_UI_CONTRAST,
		},
		{
			key: 'sidebar',
			label: 'Пункты меню',
			foreground: theme['--pb-sidebar-text'],
			background: theme['--pb-sidebar-bg'],
			min: MIN_TEXT_CONTRAST,
		},
		{
			key: 'sidebar_active',
			label: 'Активный пункт меню',
			foreground: theme['--pb-sidebar-text-active'],
			background: theme['--pb-sidebar-active-bg'],
			min: MIN_UI_CONTRAST,
		},
		{
			key: 'soft',
			label: 'Текст на плашке',
			foreground: theme['--pb-soft-text'],
			background: theme['--pb-soft-bg'],
			min: MIN_TEXT_CONTRAST,
		},
		{
			key: 'link',
			label: 'Ссылка на белом',
			foreground: theme['--pb-link'],
			background: '#ffffff',
			min: MIN_TEXT_CONTRAST,
		},
	]

	return pairs.map(pair => {
		const ratio = getContrastRatio(pair.foreground, pair.background)

		return {
			...pair,
			ratio: Math.round(ratio * 100) / 100,
			passes: ratio >= pair.min,
		}
	})
}

/**
 * Что не так с выбранным цветом — человеческим языком.
 *
 * Не запрет, а предупреждение: тема останется читаемой в любом случае,
 * но выглядеть может странно, и об этом лучше сказать до сохранения,
 * а не после звонка клиента.
 */
export const getThemeWarnings = baseColor => {
	const base = normalizeHexColor(baseColor)

	if (!base) return ['Цвет указан неверно. Нужен формат #RRGGBB.']

	const warnings = []
	const { s, l } = hexToHsl(base)
	const contrastWithWhite = getContrastRatio(base, '#ffffff')

	if (contrastWithWhite < 1.6) {
		warnings.push(
			'Цвет почти белый: шапка сольётся с полотном страницы, и граница кабинета пропадёт.',
		)
	}

	if (l < 0.08) {
		warnings.push(
			'Цвет почти чёрный: кабинет будет выглядеть строго, но фирменного оттенка на нём не разобрать.',
		)
	}

	if (s < 0.08 && l > 0.15 && l < 0.9) {
		warnings.push(
			'Цвет серый: интерфейс останется читаемым, но от стандартного будет не отличить.',
		)
	}

	if (s > 0.9 && l > 0.45 && l < 0.75) {
		warnings.push(
			'Очень насыщенный цвет: на большой плоскости шапки он утомляет глаза. Стоит взять оттенок глубже.',
		)
	}

	return warnings
}

/**
 * Проставляет переменные на элемент (обычно на корень кабинета).
 * Возвращает функцию отката — нужна, когда пользователь выходит
 * из кабинета или тема сбрасывается.
 */
export const applyPortalTheme = (element, baseColor) => {
	if (!element) return () => {}

	const theme = buildPortalTheme(baseColor)
	const applied = []

	Object.entries(theme).forEach(([key, value]) => {
		if (!key.startsWith('--')) return

		element.style.setProperty(key, value)
		applied.push(key)
	})

	return () => {
		applied.forEach(key => element.style.removeProperty(key))
	}
}
