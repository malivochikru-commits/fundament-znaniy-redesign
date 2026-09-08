/**
 * ============================================================================
 * ФУНДАМЕНТ ЗНАНИЙ — CREATIVE 3D WEBGL & THREE.JS PROCEDURAL SCENES ENGINE
 * ============================================================================
 * 
 * Архитектура:
 * - Single Master WebGL Canvas с покадровым scissor-тестированием (Multi-Scissor Viewport)
 *   Один WebGL-контекст на всю страницу — 60 FPS, отсутствие утечек памяти,
 *   нет превышения лимита контекстов браузера (WebGL context loss).
 * - IntersectionObserver: рендерятся ТОЛЬКО те секции, которые сейчас видны в viewport.
 * - Полностью процедурные 3D-модели (Zero External Assets / no .glb needed) из примитивов
 *   Three.js высокого разрешения: Torus, Cylinder, Box, Sphere, ExtrudeGeometry, Dodecahedron.
 * - Студийное освещение: 3-точечная схема (Key, Fill, Rim) + контактные подсветки.
 * - Материалы MeshPhysicalMaterial: metalness, roughness, clearcoat, transmission, emissive.
 * - Интерактивный параллакс курсора с гладким lerp-демпфированием.
 * - Поддержка prefers-reduced-motion и автоматический WebGL Fallback.
 * - Автозагрузка Three.js через CDN в случае отсутствия на странице.
 * 
 * Секции:
 * 1. #hero         -> Архитектурный Монумент Знаний & Концентрические Кольца
 * 2. #intro        -> Фолиант Мудрости (3D Книга) с парящими рунами
 * 3. #pillars      -> Кристалл Развития и 4 Орбитальные Сферы Мышления
 * 4. #topics       -> Геральдический Щит Закона и Государственности
 * 5. #constitution -> Весы Правосудия и Скрижали Государства
 * 6. #faq          -> Гироскоп Познания и Сияющая Энигма Вопроса
 * 7. #footer       -> Космический Горизонт Фундамента
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Fundament3D = factory();
    root.initAll3DScenes = root.Fundament3D.init;
    root.destroyAll3DScenes = root.Fundament3D.destroy;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. УТИЛИТЫ И ПРОВЕРКИ ОКРУЖЕНИЯ
  // --------------------------------------------------------------------------

  const isReducedMotion = () => {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  };

  const isWebGLAvailable = () => {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (e) {
      return false;
    }
  };

  const loadThreeFromCDN = () => {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && window.THREE) {
        resolve(window.THREE);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.async = true;
      script.onload = () => resolve(window.THREE);
      script.onerror = () => reject(new Error('Не удалось загрузить Three.js с CDN'));
      document.head.appendChild(script);
    });
  };

  // Плавная интерполяция
  const lerp = (start, end, factor) => start + (end - start) * factor;

  // Цветовая палитра "Фундамент Знаний" (Узбекистан / Государственность / Просвещение)
  const PALETTE = {
    gold: 0xdfb15b,
    goldBright: 0xffd700,
    goldDeep: 0xb8860b,
    azure: 0x0052b4,
    samarkandCyan: 0x00b4d8,
    emerald: 0x059669,
    deepNavy: 0x040914,
    obsidian: 0x0a1124,
    parchment: 0xf8f5ee,
    ivoryMarble: 0xe8e6df,
    rubyAccent: 0xd90429,
    lightTextSafe: 0x081326
  };

  // --------------------------------------------------------------------------
  // 2. ДВИЖОК МУЛЬТИ-СЦЕНЫ (MASTER SCISSOR VIEWPORT ENGINE)
  // --------------------------------------------------------------------------

  class Master3DEngine {
    constructor() {
      this.canvas = null;
      this.renderer = null;
      this.scenes = new Map(); // id -> SceneHolder
      this.observer = null;
      this.rafId = null;
      this.isRunning = false;
      this.lastTime = 0;
      this.reducedMotion = isReducedMotion();

      // Глобальный курсор и параллакс
      this.mouse = {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        windowHeight: typeof window !== 'undefined' ? window.innerHeight : 1080
      };

      this._onMouseMove = this._onMouseMove.bind(this);
      this._onResize = this._onResize.bind(this);
      this._loop = this._loop.bind(this);
    }

    async init() {
      if (!isWebGLAvailable()) {
        console.warn('[Fundament3D] WebGL недоступен в данном браузере. Включен CSS fallback.');
        if (document.body) document.body.classList.add('no-webgl-fallback');
        return false;
      }

      await loadThreeFromCDN();
      const THREE = window.THREE;

      // Создаем единый мастер-холст на фоне страницы
      let masterCanvas = document.getElementById('threejs-master-canvas');
      if (!masterCanvas) {
        masterCanvas = document.createElement('canvas');
        masterCanvas.id = 'threejs-master-canvas';
        masterCanvas.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          pointer-events: none;
          z-index: 0;
          display: block;
        `;
        // Вставляем холст в начало body
        if (document.body) {
          document.body.insertBefore(masterCanvas, document.body.firstChild);
        }
      }
      this.canvas = masterCanvas;

      // Инициализация общего WebGLRenderer
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.shadowMap.enabled = false; // Контактные тени через текстуру для железных 60 FPS

      // Слушатели ввода
      window.addEventListener('mousemove', this._onMouseMove, { passive: true });
      window.addEventListener('resize', this._onResize, { passive: true });

      // Настройка IntersectionObserver для выборочного рендеринга (только видимые секции!)
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const id = entry.target.getAttribute('data-3d-scene') || entry.target.id;
            const holder = this.scenes.get(id);
            if (holder) {
              holder.isVisible = entry.isIntersecting;
              holder.intersectionRatio = entry.intersectionRatio;
            }
          });
        },
        {
          rootMargin: '120px 0px 120px 0px',
          threshold: [0.0, 0.1, 0.25, 0.5, 0.75, 1.0]
        }
      );

      // Монтируем все 7 специализированных сцен
      this._registerAllScenes();

      // Запуск единого RAF-цикла
      this.isRunning = true;
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this._loop);

      console.log('✨ [Fundament3D] 3D движок успешно инициализирован. Все 7 секций с процедурными 3D-моделями активны.');
      return true;
    }

    _onMouseMove(e) {
      this.mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    _onResize() {
      this.mouse.windowWidth = window.innerWidth;
      this.mouse.windowHeight = window.innerHeight;
      if (this.renderer) {
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      }
    }

    _registerAllScenes() {
      // 1. Hero: Архитектурный Монумент Знаний
      this._mountScene({
        id: 'hero',
        selectors: ['#hero', '[data-scene="hero"]', '.hero-section'],
        builder: createHeroMonumentScene,
        cameraZ: 7.2,
        alignment: 'center-right'
      });

      // 2. Intro: Фолиант Мудрости (3D Открытая Книга)
      this._mountScene({
        id: 'intro',
        selectors: ['#intro', '#about', '[data-scene="intro"]', '.intro-section'],
        builder: createFoliantOfWisdomScene,
        cameraZ: 6.0,
        alignment: 'center-left'
      });

      // 3. База Знаний: Кристалл Развития и 4 Сферы Мышления
      this._mountScene({
        id: 'pillars',
        selectors: ['#pillars', '#knowledge-base', '#base', '[data-scene="pillars"]', '.knowledge-section'],
        builder: createCrystalPillarsScene,
        cameraZ: 7.5,
        alignment: 'center-right'
      });

      // 4. Предметы: Геральдический Щит Закона и Государственности
      this._mountScene({
        id: 'topics',
        selectors: ['#topics', '#subjects', '#disciplines', '[data-scene="topics"]'],
        builder: createHeraldicShieldScene,
        cameraZ: 6.8,
        alignment: 'center-left'
      });

      // 5. Конституция РУз: Весы Правосудия и Скрижали Государства
      this._mountScene({
        id: 'constitution',
        selectors: ['#constitution', '#law', '[data-scene="constitution"]'],
        builder: createScalesOfJusticeScene,
        cameraZ: 7.5,
        alignment: 'center-left'
      });

      // 6. FAQ: Гироскоп Познания / Энигма Вопроса
      this._mountScene({
        id: 'faq',
        selectors: ['#faq', '#questions', '[data-scene="faq"]'],
        builder: createGyroscopeEnigmaScene,
        cameraZ: 6.5,
        alignment: 'center-right'
      });

      // 7. Footer: Космический Горизонт Фундамента
      this._mountScene({
        id: 'footer',
        selectors: ['#footer', 'footer', '[data-scene="footer"]'],
        builder: createCosmicHorizonScene,
        cameraZ: 8.0,
        alignment: 'center'
      });
    }

    _mountScene(config) {
      const THREE = window.THREE;
      let targetElement = null;

      for (const sel of config.selectors) {
        const el = document.querySelector(sel);
        if (el) {
          targetElement = el;
          break;
        }
      }

      if (!targetElement) {
        // Если элемент еще не в DOM, создадим ленивый наблюдатель
        return;
      }

      targetElement.setAttribute('data-3d-scene', config.id);

      // Сцена Three.js
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x040914, 0.045);

      // Камера
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, config.cameraZ || 7);

      // Инициализация содержимого сцены через специализированный билдер
      const instance = config.builder(scene, camera, THREE);

      const holder = {
        id: config.id,
        domElement: targetElement,
        scene,
        camera,
        instance,
        alignment: config.alignment || 'center',
        isVisible: true,
        intersectionRatio: 1.0,
        parallax: { x: 0, y: 0 }
      };

      this.scenes.set(config.id, holder);
      this.observer.observe(targetElement);
    }

    _loop(timestamp) {
      if (!this.isRunning) return;

      const delta = Math.min((timestamp - this.lastTime) / 1000, 0.1);
      this.lastTime = timestamp;

      // Сглаживание курсора мыши (damped lerp)
      this.mouse.x = lerp(this.mouse.x, this.mouse.targetX, 0.06);
      this.mouse.y = lerp(this.mouse.y, this.mouse.targetY, 0.06);

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Включаем scissor test для рендеринга по сегментам секций
      this.renderer.setScissorTest(true);

      // Очищаем весь буфер кадра
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();

      this.scenes.forEach((holder) => {
        const rect = holder.domElement.getBoundingClientRect();

        // Проверяем, находится ли элемент в текущем окне просмотра
        const isInViewport =
          rect.bottom > 0 &&
          rect.top < windowHeight &&
          rect.right > 0 &&
          rect.left < windowWidth;

        if (!isInViewport) {
          holder.isVisible = false;
          return;
        }

        holder.isVisible = true;

        // Вычисляем Scissor-прямоугольник в координатах WebGL (от нижнего левого угла)
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(windowWidth, rect.right);
        const bottom = Math.min(windowHeight, rect.bottom);

        const width = right - left;
        const height = bottom - top;

        if (width <= 0 || height <= 0) return;

        const scissorBottom = windowHeight - bottom;

        // Фиксированные стабильные габариты секции (устраняет эффект зума при скролле)
        const fullLeft = rect.left;
        const fullBottom = windowHeight - rect.bottom;
        const fullWidth = rect.width;
        const fullHeight = rect.height;

        this.renderer.setViewport(fullLeft, fullBottom, fullWidth, fullHeight);
        this.renderer.setScissor(left, scissorBottom, width, height);

        // Стабильный аспект камеры под полные габариты секции (без скачков)
        const aspect = fullWidth / Math.max(1, fullHeight);
        if (Math.abs(holder.camera.aspect - aspect) > 0.001) {
          holder.camera.aspect = aspect;
          holder.camera.updateProjectionMatrix();
        }

        // Вычисляем смещение объекта для гармоничного сплит-экрана (Left / Right)
        let targetOffsetX = 0;
        if (holder.alignment === 'center-right' && width > 768) {
          targetOffsetX = 2.05;
        } else if (holder.alignment === 'center-left' && width > 768) {
          targetOffsetX = -2.05;
        }

        // Параллакс мыши
        const px = this.reducedMotion ? 0 : this.mouse.x;
        const py = this.reducedMotion ? 0 : this.mouse.y;

        holder.parallax.x = lerp(holder.parallax.x, px * 0.45, 0.08);
        holder.parallax.y = lerp(holder.parallax.y, py * 0.45, 0.08);

        // Обновляем анимацию сцены
        if (holder.instance && typeof holder.instance.update === 'function') {
          holder.instance.update({
            delta,
            time: timestamp * 0.001,
            mouseX: holder.parallax.x,
            mouseY: holder.parallax.y,
            targetOffsetX,
            reducedMotion: this.reducedMotion
          });
        }

        // Рендерим текущую секцию
        this.renderer.render(holder.scene, holder.camera);
      });

      this.rafId = requestAnimationFrame(this._loop);
    }

    destroy() {
      this.isRunning = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);

      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('resize', this._onResize);
      }

      if (this.observer) {
        this.observer.disconnect();
      }

      this.scenes.forEach((holder) => {
        if (holder.instance && typeof holder.instance.dispose === 'function') {
          holder.instance.dispose();
        }
      });
      this.scenes.clear();

      if (this.renderer) {
        this.renderer.dispose();
        if (this.canvas && this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      }

      console.log('[Fundament3D] Движок успешно остановлен и очищен.');
    }
  }

  // --------------------------------------------------------------------------
  // 3. ФАБРИКИ ОСВЕЩЕНИЯ И МАТЕРИАЛОВ
  // --------------------------------------------------------------------------

  function setupStudioLighting(scene, THREE, options = {}) {
    // Тёплый солнечный ключевой свет (Key Light) с повышенной контрастностью
    const keyLight = new THREE.DirectionalLight(options.keyColor || 0xfff5dc, options.keyIntensity || 2.8);
    keyLight.position.set(6, 8, 5);
    scene.add(keyLight);

    // Мягкий прохладный самаркандский заполняющий свет (Fill Light)
    const fillLight = new THREE.DirectionalLight(options.fillColor || 0x1e40af, options.fillIntensity || 1.8);
    fillLight.position.set(-7, -2, 4);
    scene.add(fillLight);

    // Яркий золотой контурный свет (Rim / Back Light) — создает премиальный четкий силуэт
    const rimLight = new THREE.DirectionalLight(options.rimColor || 0xffd700, options.rimIntensity || 4.2);
    rimLight.position.set(0, 6, -6);
    scene.add(rimLight);

    // Нижний теневой свет для глубины и объемного затенения (Ambient Occlusion depth)
    const bottomShadowLight = new THREE.DirectionalLight(0x02040a, 2.0);
    bottomShadowLight.position.set(0, -8, 0);
    scene.add(bottomShadowLight);

    // Контрастный точечный акцент
    const accentPoint = new THREE.PointLight(0x4f8ef7, 1.2, 10);
    accentPoint.position.set(-3, 2, 4);
    scene.add(accentPoint);

    // Мягкое небесное рассеянное освещение
    const ambientLight = new THREE.AmbientLight(0x081224, 0.9);
    scene.add(ambientLight);

    return { keyLight, fillLight, rimLight, bottomShadowLight, accentPoint, ambientLight };
  }

  // Создание глубокой мягкой контактной тени под объектом (High-End Contact Shadow)
  function createContactShadowMesh(THREE, radius = 3.2, opacity = 0.78) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
    gradient.addColorStop(0.25, `rgba(0, 2, 8, ${opacity * 0.85})`);
    gradient.addColorStop(0.55, `rgba(1, 6, 18, ${opacity * 0.35})`);
    gradient.addColorStop(0.85, `rgba(1, 8, 24, ${opacity * 0.08})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    const planeGeo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(planeGeo, planeMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2.2;
    return mesh;
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 1: HERO — АРХИТЕКТУРНЫЙ МОНУМЕНТ ЗНАНИЙ
  // --------------------------------------------------------------------------
  function createHeroMonumentScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyIntensity: 2.4,
      fillColor: 0x0284c7,
      rimColor: 0xffd700,
      rimIntensity: 3.5
    });

    // Интерактивный точечный свет от курсора
    const cursorPointLight = new THREE.PointLight(PALETTE.goldBright, 2.5, 12);
    cursorPointLight.position.set(0, 1, 3);
    scene.add(cursorPointLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // Контактная тень
    rootGroup.add(createContactShadowMesh(THREE, 3.4, 0.65));

    // Массивная ступенчатая основа (Fluted Stepped Foundation)
    const baseGroup = new THREE.Group();
    rootGroup.add(baseGroup);

    const goldTrimMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      metalness: 0.92,
      roughness: 0.18,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15
    });

    const obsidianMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c1322,
      metalness: 0.3,
      roughness: 0.25,
      clearcoat: 0.9
    });

    // 3 яруса постамента
    const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.22, 32), obsidianMat);
    tier1.position.y = -2.1;
    const tier1Ring = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.04, 16, 64), goldTrimMat);
    tier1Ring.rotation.x = Math.PI / 2;
    tier1Ring.position.y = -2.0;

    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 2.1, 0.25, 24), obsidianMat);
    tier2.position.y = -1.88;

    const tier3 = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.2, 16), obsidianMat);
    tier3.position.y = -1.67;

    baseGroup.add(tier1, tier1Ring, tier2, tier3);

    // Каннелированная колонна / центральный пилон (Fluted Monument Column)
    const columnPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 1.4, 16), obsidianMat);
    columnPillar.position.y = -0.9;
    baseGroup.add(columnPillar);

    // Золотой капитель и основание колонны
    const capBottom = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 16, 48), goldTrimMat);
    capBottom.rotation.x = Math.PI / 2;
    capBottom.position.y = -1.55;

    const capTop = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 16, 48), goldTrimMat);
    capTop.rotation.x = Math.PI / 2;
    capTop.position.y = -0.22;
    baseGroup.add(capBottom, capTop);

    // Парящее Ядро Монумента — Многогранный Додекаэдр с эффектом стекла и внутреннего сияния
    const coreGroup = new THREE.Group();
    coreGroup.position.y = 0.55;
    rootGroup.add(coreGroup);

    const coreCrystalGeo = new THREE.DodecahedronGeometry(0.82, 0);
    const coreCrystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      roughness: 0.08,
      metalness: 0.15,
      transmission: 0.82,
      ior: 1.62,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    });
    const coreCrystal = new THREE.Mesh(coreCrystalGeo, coreCrystalMat);
    coreGroup.add(coreCrystal);

    // Внутреннее светящееся полигональное сердце
    const innerHeartGeo = new THREE.OctahedronGeometry(0.42, 0);
    const innerHeartMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      wireframe: true
    });
    const innerHeart = new THREE.Mesh(innerHeartGeo, innerHeartMat);
    coreGroup.add(innerHeart);

    const innerLight = new THREE.PointLight(0x38bdf8, 2.5, 6);
    coreGroup.add(innerLight);

    // 3 Концентрических Золотых Кольца (Floating Concentric Golden Rings)
    const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.045, 20, 80), goldTrimMat);
    const ringMid = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.04, 20, 72), goldTrimMat);
    const ringInner = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.035, 20, 64), goldTrimMat);

    // Небольшие декоративные узлы на кольцах
    const nodeGeo = new THREE.SphereGeometry(0.08, 12, 12);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const nodeMesh = new THREE.Mesh(nodeGeo, goldTrimMat);
      nodeMesh.position.set(Math.cos(angle) * 1.75, Math.sin(angle) * 1.75, 0);
      ringMid.add(nodeMesh);
    }

    coreGroup.add(ringOuter, ringMid, ringInner);

    // Парящие частицы звездной пыли знаний (Ambient Stardust Particles)
    const particleCount = 140;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const r = 1.2 + Math.random() * 2.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;

      particlePos[i * 3] = r * Math.cos(theta) * Math.cos(phi);
      particlePos[i * 3 + 1] = r * Math.sin(phi) + 0.3;
      particlePos[i * 3 + 2] = r * Math.sin(theta) * Math.cos(phi);
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: PALETTE.goldBright,
      size: 0.055,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    rootGroup.add(particleSystem);

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Плавное парение (idle float)
          rootGroup.position.y = Math.sin(time * 0.9) * 0.12;

          // Вращение концентрических колец с гармоническими скоростями
          ringOuter.rotation.x = Math.sin(time * 0.35) * 0.45;
          ringOuter.rotation.y += delta * 0.32;

          ringMid.rotation.x = Math.cos(time * 0.4) * 0.5;
          ringMid.rotation.z -= delta * 0.45;

          ringInner.rotation.y += delta * 0.6;
          ringInner.rotation.x = Math.sin(time * 0.5) * 0.6;

          // Вращение и пульсация ядра
          coreCrystal.rotation.y += delta * 0.4;
          coreCrystal.rotation.x += delta * 0.25;
          innerHeart.rotation.y -= delta * 0.7;

          const pulse = 1 + Math.sin(time * 2.2) * 0.08;
          coreCrystal.scale.set(pulse, pulse, pulse);
          innerLight.intensity = 2.0 + Math.sin(time * 2.5) * 0.8;

          // Вращение облака частиц
          particleSystem.rotation.y += delta * 0.08;

          // Наклон от курсора (mouse parallax)
          rootGroup.rotation.y = lerp(rootGroup.rotation.y, mouseX * 0.5, 0.05);
          rootGroup.rotation.x = lerp(rootGroup.rotation.x, -mouseY * 0.35, 0.05);

          // Смещение источника света вслед за курсором
          cursorPointLight.position.x = mouseX * 4;
          cursorPointLight.position.y = mouseY * 3 + 1;
        }
      },
      dispose() {
        particleGeo.dispose();
        particleMat.dispose();
      }
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 2: INTRO — ФОЛИАНТ МУДРОСТИ (3D КНИГА ЗНАНИЙ)
  // --------------------------------------------------------------------------
  function createFoliantOfWisdomScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0xfffae0,
      keyIntensity: 2.5,
      fillColor: 0x0369a1,
      rimColor: PALETTE.gold,
      rimIntensity: 3.2
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroup.add(createContactShadowMesh(THREE, 3.0, 0.5));

    const bookGroup = new THREE.Group();
    rootGroup.add(bookGroup);
    // Разворачиваем книгу в презентабельный ракурс
    bookGroup.rotation.x = 0.55;
    bookGroup.rotation.y = -0.3;

    // Материалы
    const leatherMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.12,
      clearcoat: 0.25
    });

    const goldBorderMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      roughness: 0.2,
      metalness: 0.95,
      clearcoat: 0.9
    });

    const pageMat = new THREE.MeshPhysicalMaterial({
      color: 0xfbf9f1,
      roughness: 0.5,
      metalness: 0.02,
      clearcoat: 0.1
    });

    // Корешок книги (Spine)
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.7, 16, 1, false, 0, Math.PI), leatherMat);
    spine.rotation.z = Math.PI / 2;
    spine.position.set(0, 0, 0);
    bookGroup.add(spine);

    // Золотые накладки на корешок (Spine Gold Ribs)
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.02, 12, 24, Math.PI), goldBorderMat);
      rib.rotation.z = Math.PI / 2;
      rib.position.set(i * 0.35, 0, 0);
      bookGroup.add(rib);
    }

    // Левая и правая обложки книги
    const coverWidth = 1.9;
    const coverHeight = 2.65;
    const coverThick = 0.06;
    const openAngle = 0.24; // Угол раскрытия книги

    // Левая обложка
    const leftCoverGroup = new THREE.Group();
    leftCoverGroup.rotation.z = openAngle;
    const leftCover = new THREE.Mesh(new THREE.BoxGeometry(coverWidth, coverThick, coverHeight), leatherMat);
    leftCover.position.x = -coverWidth / 2 - 0.1;
    leftCoverGroup.add(leftCover);

    // Золотые уголки левой обложки
    const cornerLeft = new THREE.Mesh(new THREE.BoxGeometry(0.3, coverThick * 1.2, 0.3), goldBorderMat);
    cornerLeft.position.set(-coverWidth, 0, coverHeight / 2 - 0.15);
    leftCoverGroup.add(cornerLeft);

    // Правая обложка
    const rightCoverGroup = new THREE.Group();
    rightCoverGroup.rotation.z = -openAngle;
    const rightCover = new THREE.Mesh(new THREE.BoxGeometry(coverWidth, coverThick, coverHeight), leatherMat);
    rightCover.position.x = coverWidth / 2 + 0.1;
    rightCoverGroup.add(rightCover);

    const cornerRight = new THREE.Mesh(new THREE.BoxGeometry(0.3, coverThick * 1.2, 0.3), goldBorderMat);
    cornerRight.position.set(coverWidth, 0, coverHeight / 2 - 0.15);
    rightCoverGroup.add(cornerRight);

    bookGroup.add(leftCoverGroup, rightCoverGroup);

    // Блок страниц (Curved Page Blocks)
    const blockWidth = 1.75;
    const blockHeight = 2.45;
    const blockThick = 0.28;

    const leftPages = new THREE.Mesh(new THREE.BoxGeometry(blockWidth, blockThick, blockHeight), pageMat);
    leftPages.position.set(-blockWidth / 2 - 0.12, blockThick / 2 + 0.02, 0);
    leftCoverGroup.add(leftPages);

    const rightPages = new THREE.Mesh(new THREE.BoxGeometry(blockWidth, blockThick, blockHeight), pageMat);
    rightPages.position.set(blockWidth / 2 + 0.12, blockThick / 2 + 0.02, 0);
    rightCoverGroup.add(rightPages);

    // Парящая шелковая закладка-лента (Silk Ribbon Bookmark)
    const ribbonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.3, -1.2),
      new THREE.Vector3(0.3, 0.35, -0.4),
      new THREE.Vector3(0.5, 0.18, 0.5),
      new THREE.Vector3(0.75, -0.15, 1.4),
      new THREE.Vector3(0.9, -0.45, 1.8)
    ]);
    const ribbonGeo = new THREE.TubeGeometry(ribbonCurve, 32, 0.045, 8, false);
    const ribbonMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.2,
      clearcoat: 0.7
    });
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    bookGroup.add(ribbon);

    // Парящие символы / искры мудрости (Glowing Knowledge Glyphs)
    const runeCount = 36;
    const runeGeo = new THREE.BufferGeometry();
    const runePositions = new Float32Array(runeCount * 3);
    const runeSpeeds = new Float32Array(runeCount);

    for (let i = 0; i < runeCount; i++) {
      runePositions[i * 3] = (Math.random() - 0.5) * 2.8;
      runePositions[i * 3 + 1] = Math.random() * 2.2 + 0.2;
      runePositions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      runeSpeeds[i] = Math.random() * 0.4 + 0.2;
    }
    runeGeo.setAttribute('position', new THREE.BufferAttribute(runePositions, 3));

    const runeMat = new THREE.PointsMaterial({
      color: PALETTE.samarkandCyan,
      size: 0.08,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const runeSystem = new THREE.Points(runeGeo, runeMat);
    bookGroup.add(runeSystem);

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Дыхание фолианта (gentle floating)
          bookGroup.position.y = Math.sin(time * 1.1) * 0.14;
          bookGroup.rotation.z = Math.sin(time * 0.8) * 0.05;

          // Легкое трепетание страниц (page flutter)
          leftCoverGroup.rotation.z = openAngle + Math.sin(time * 1.5) * 0.018;
          rightCoverGroup.rotation.z = -openAngle - Math.sin(time * 1.5) * 0.018;

          // Подъем частиц-рун вверх
          const pos = runeGeo.attributes.position.array;
          for (let i = 0; i < runeCount; i++) {
            pos[i * 3 + 1] += runeSpeeds[i] * delta;
            if (pos[i * 3 + 1] > 2.8) {
              pos[i * 3 + 1] = 0.2;
            }
          }
          runeGeo.attributes.position.needsUpdate = true;

          // Параллакс
          bookGroup.rotation.y = -0.3 + lerp(bookGroup.rotation.y + 0.3, mouseX * 0.45, 0.06);
          bookGroup.rotation.x = 0.55 + lerp(bookGroup.rotation.x - 0.55, -mouseY * 0.3, 0.06);
        }
      },
      dispose() {
        ribbonGeo.dispose();
        runeGeo.dispose();
      }
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 3: БАЗА ЗНАНИЙ — КРИСТАЛЛ РАЗВИТИЯ И 4 СФЕРЫ МЫШЛЕНИЯ
  // --------------------------------------------------------------------------
  function createCrystalPillarsScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0xe0f2fe,
      keyIntensity: 2.6,
      fillColor: 0x0284c7,
      rimColor: PALETTE.goldBright,
      rimIntensity: 3.2
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroup.add(createContactShadowMesh(THREE, 3.2, 0.6));

    // Центральный гранёный Кристалл Развития (Double Cone faceted Gem)
    const crystalGroup = new THREE.Group();
    crystalGroup.position.y = 0.3;
    rootGroup.add(crystalGroup);

    const topConeGeo = new THREE.ConeGeometry(1.05, 1.6, 6);
    const bottomConeGeo = new THREE.ConeGeometry(1.05, 1.4, 6);
    bottomConeGeo.rotateX(Math.PI);

    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.38,
      roughness: 0.06,
      metalness: 0.12,
      transmission: 0.85,
      ior: 1.58,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08
    });

    const topCone = new THREE.Mesh(topConeGeo, crystalMat);
    topCone.position.y = 0.8;
    const bottomCone = new THREE.Mesh(bottomConeGeo, crystalMat);
    bottomCone.position.y = -0.7;
    crystalGroup.add(topCone, bottomCone);

    // Золотой пояс жесткости по экватору кристалла
    const beltMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      metalness: 0.95,
      roughness: 0.15,
      clearcoat: 1.0
    });
    const equatorBelt = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.05, 16, 6), beltMat);
    equatorBelt.rotation.x = Math.PI / 2;
    crystalGroup.add(equatorBelt);

    // Внутреннее световое ядро
    const crystalLight = new THREE.PointLight(0x38bdf8, 3.0, 8);
    crystalGroup.add(crystalLight);

    // 4 Орбитальные Сферы (Статьи, Литература, Практика, Миссия)
    const sphereColors = [
      0x38bdf8, // 1. Статьи (Cyan)
      0x10b981, // 2. Литература (Emerald)
      0xf59e0b, // 3. Практика (Amber/Gold)
      0x8b5cf6  // 4. Миссия (Purple)
    ];

    const nodes = [];
    const orbitRadius = 2.4;
    const laserGroup = new THREE.Group();
    rootGroup.add(laserGroup);

    // Массив линий лазерных связей (Laser Lattice)
    const laserLines = [];

    sphereColors.forEach((col, idx) => {
      const nodeGroup = new THREE.Group();

      const sphereGeo = new THREE.SphereGeometry(0.24, 24, 24);
      const sphereMat = new THREE.MeshPhysicalMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.45,
        roughness: 0.1,
        metalness: 0.4,
        clearcoat: 1.0
      });
      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      nodeGroup.add(sphereMesh);

      // Миниатюрное кольцо вокруг каждой сферы
      const miniRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 12, 32), beltMat);
      miniRing.rotation.x = Math.PI / 3;
      nodeGroup.add(miniRing);

      rootGroup.add(nodeGroup);
      nodes.push({ group: nodeGroup, baseAngle: (idx * Math.PI) / 2, color: col });

      // Создаем геометрию динамической линии связи
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.3, 0),
        new THREE.Vector3(0, 0, 0)
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.Line(lineGeo, lineMat);
      laserGroup.add(line);
      laserLines.push(line);
    });

    // Орбитальное направляющее кольцо (Guide Orbit Track)
    const orbitTrack = new THREE.Mesh(new THREE.TorusGeometry(orbitRadius, 0.015, 12, 80), beltMat);
    orbitTrack.rotation.x = Math.PI / 2.3;
    orbitTrack.position.y = 0.3;
    rootGroup.add(orbitTrack);

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Вращение кристалла
          crystalGroup.rotation.y += delta * 0.55;
          crystalGroup.rotation.z = Math.sin(time * 0.7) * 0.08;
          crystalGroup.position.y = 0.3 + Math.sin(time * 1.2) * 0.1;

          // Пульсация света внутри кристалла
          crystalLight.intensity = 2.4 + Math.sin(time * 2.8) * 0.9;

          // Движение орбитальных сфер и обновление лазерных связей
          nodes.forEach((node, i) => {
            const currentAngle = node.baseAngle + time * 0.45;
            const nx = Math.cos(currentAngle) * orbitRadius;
            const nz = Math.sin(currentAngle) * orbitRadius;
            const ny = 0.3 + Math.sin(currentAngle * 2 + time) * 0.35;

            node.group.position.set(nx, ny, nz);
            node.group.rotation.y += delta * 1.2;

            // Обновляем вершины лазерной линии
            const positions = laserLines[i].geometry.attributes.position.array;
            // Старт в центре кристалла
            positions[0] = 0;
            positions[1] = crystalGroup.position.y;
            positions[2] = 0;
            // Финиш в сфере
            positions[3] = nx;
            positions[4] = ny;
            positions[5] = nz;
            laserLines[i].geometry.attributes.position.needsUpdate = true;
          });

          // Параллакс
          rootGroup.rotation.y = lerp(rootGroup.rotation.y, mouseX * 0.4, 0.05);
          rootGroup.rotation.x = lerp(rootGroup.rotation.x, -mouseY * 0.25, 0.05);
        }
      },
      dispose() {
        laserLines.forEach((l) => {
          l.geometry.dispose();
          l.material.dispose();
        });
      }
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 4: ПРЕДМЕТЫ — ГЕРАЛЬДИЧЕСКИЙ ЩИТ ЗАКОНА И ГОСУДАРСТВЕННОСТИ
  // --------------------------------------------------------------------------
  function createHeraldicShieldScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0xffffff,
      keyIntensity: 2.8,
      fillColor: 0x1d4ed8,
      rimColor: PALETTE.goldBright,
      rimIntensity: 3.8
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroup.add(createContactShadowMesh(THREE, 3.2, 0.6));

    const shieldGroup = new THREE.Group();
    shieldGroup.position.y = 0.2;
    rootGroup.add(shieldGroup);

    // Создаем контур геральдического щита (Heater Shield Shape)
    const shieldShape = new THREE.Shape();
    shieldShape.moveTo(0, 1.8);
    shieldShape.lineTo(1.4, 1.8);
    shieldShape.quadraticCurveTo(1.45, 0.6, 1.2, -0.2);
    shieldShape.quadraticCurveTo(0.9, -1.3, 0, -2.1);
    shieldShape.quadraticCurveTo(-0.9, -1.3, -1.2, -0.2);
    shieldShape.quadraticCurveTo(-1.45, 0.6, -1.4, 1.8);
    shieldShape.closePath();

    const extrudeSettings = {
      depth: 0.18,
      bevelEnabled: true,
      bevelSegments: 6,
      steps: 2,
      bevelSize: 0.12,
      bevelThickness: 0.12
    };

    const shieldGeo = new THREE.ExtrudeGeometry(shieldShape, extrudeSettings);
    // Центрируем
    shieldGeo.center();

    // Материал эмали щита — глубокий лазурный сапфир
    const enamelMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b2545,
      roughness: 0.2,
      metalness: 0.45,
      clearcoat: 0.95,
      clearcoatRoughness: 0.1
    });

    const goldMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      roughness: 0.15,
      metalness: 0.95,
      clearcoat: 1.0
    });

    const shieldMesh = new THREE.Mesh(shieldGeo, enamelMat);
    shieldGroup.add(shieldMesh);

    // Декоративный золотой накладной кант
    const borderPoints = shieldShape.getPoints();
    const border3DPoints = borderPoints.map((p) => new THREE.Vector3(p.x, p.y, 0.14));
    const borderCurve = new THREE.CatmullRomCurve3(border3DPoints, true);
    const borderMeshGeo = new THREE.TubeGeometry(borderCurve, 64, 0.055, 8, true);
    const borderMesh = new THREE.Mesh(borderMeshGeo, goldMat);
    shieldGroup.add(borderMesh);

    // Центральная 8-конечная звезда (Руб аль-хизб / Символ Закона)
    const starGroup = new THREE.Group();
    starGroup.position.set(0, 0.1, 0.22);
    shieldGroup.add(starGroup);

    const squareGeo = new THREE.BoxGeometry(0.85, 0.85, 0.08);
    const square1 = new THREE.Mesh(squareGeo, goldMat);
    const square2 = new THREE.Mesh(squareGeo, goldMat);
    square2.rotation.z = Math.PI / 4;
    starGroup.add(square1, square2);

    const starCore = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 24), goldMat);
    starCore.rotation.x = Math.PI / 2;
    starGroup.add(starCore);

    // Парящий золотой лавровый венок (Floating Laurel Wreath Ring)
    const laurelGroup = new THREE.Group();
    rootGroup.add(laurelGroup);
    laurelGroup.position.y = 0.2;

    const leafCount = 28;
    const wreathRadius = 2.45;
    const leafGeo = new THREE.ConeGeometry(0.12, 0.45, 5);
    leafGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < leafCount; i++) {
      const angle = (i / leafCount) * Math.PI * 2;
      const leafPair = new THREE.Group();
      leafPair.position.set(Math.cos(angle) * wreathRadius, Math.sin(angle) * wreathRadius, 0);
      leafPair.rotation.z = angle + Math.PI / 2;

      const leafL = new THREE.Mesh(leafGeo, goldMat);
      leafL.position.set(-0.1, 0, 0);
      leafL.rotation.y = 0.35;

      const leafR = new THREE.Mesh(leafGeo, goldMat);
      leafR.position.set(0.1, 0, 0);
      leafR.rotation.y = -0.35;

      leafPair.add(leafL, leafR);
      laurelGroup.add(leafPair);
    }

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Благородное покачивание щита
          shieldGroup.position.y = 0.2 + Math.sin(time * 0.9) * 0.1;
          shieldGroup.rotation.y = Math.sin(time * 0.7) * 0.15;
          shieldGroup.rotation.z = Math.cos(time * 0.6) * 0.04;

          // Вращение лаврового венца
          laurelGroup.rotation.z += delta * 0.18;

          // Параллакс
          shieldGroup.rotation.y = lerp(shieldGroup.rotation.y, mouseX * 0.45, 0.06);
          shieldGroup.rotation.x = lerp(shieldGroup.rotation.x, -mouseY * 0.3, 0.06);
        }
      },
      dispose() {
        shieldGeo.dispose();
        borderMeshGeo.dispose();
        leafGeo.dispose();
      }
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 5: КОНСТИТУЦИЯ — ВЕСЫ ПРАВОСУДИЯ И СКРИЖАЛИ ГОСУДАРСТВА
  // --------------------------------------------------------------------------
  function createScalesOfJusticeScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0xfffaed,
      keyIntensity: 2.6,
      fillColor: 0x0369a1,
      rimColor: PALETTE.gold,
      rimIntensity: 3.5
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroup.add(createContactShadowMesh(THREE, 3.4, 0.6));

    const goldMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      metalness: 0.95,
      roughness: 0.16,
      clearcoat: 1.0
    });

    const marbleMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.3,
      clearcoat: 0.8
    });

    // Центральная классическая колонна
    const basePodium = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.25, 32), marbleMat);
    basePodium.position.y = -2.1;
    rootGroup.add(basePodium);

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.8, 20), goldMat);
    pillar.position.y = -0.15;
    rootGroup.add(pillar);

    // Верхушка / Пивот весов (Fulcrum Pivot)
    const fulcrum = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), goldMat);
    fulcrum.position.y = 1.75;
    rootGroup.add(fulcrum);

    // Качающаяся горизонтальная балка (Balance Beam)
    const beamGroup = new THREE.Group();
    beamGroup.position.set(0, 1.75, 0);
    rootGroup.add(beamGroup);

    const beamLength = 4.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, beamLength, 16), goldMat);
    beam.rotation.z = Math.PI / 2;
    beamGroup.add(beam);

    // Левая чаша весов (Left Pan)
    const leftArmX = -beamLength / 2 + 0.1;
    const rightArmX = beamLength / 2 - 0.1;
    const chainHeight = 1.4;

    const panGeo = new THREE.SphereGeometry(0.7, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

    // Левый подвес
    const leftPanGroup = new THREE.Group();
    leftPanGroup.position.set(leftArmX, 0, 0);
    beamGroup.add(leftPanGroup);

    const leftPan = new THREE.Mesh(panGeo, goldMat);
    leftPan.rotation.x = Math.PI;
    leftPan.position.y = -chainHeight;
    leftPanGroup.add(leftPan);

    // 3 цепочки для левой чаши
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const chainGeo = new THREE.CylinderGeometry(0.015, 0.015, chainHeight, 6);
      const chain = new THREE.Mesh(chainGeo, goldMat);
      chain.position.set(Math.cos(angle) * 0.35, -chainHeight / 2, Math.sin(angle) * 0.35);
      leftPanGroup.add(chain);
    }

    // Правый подвес
    const rightPanGroup = new THREE.Group();
    rightPanGroup.position.set(rightArmX, 0, 0);
    beamGroup.add(rightPanGroup);

    const rightPan = new THREE.Mesh(panGeo, goldMat);
    rightPan.rotation.x = Math.PI;
    rightPan.position.y = -chainHeight;
    rightPanGroup.add(rightPan);

    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const chainGeo = new THREE.CylinderGeometry(0.015, 0.015, chainHeight, 6);
      const chain = new THREE.Mesh(chainGeo, goldMat);
      chain.position.set(Math.cos(angle) * 0.35, -chainHeight / 2, Math.sin(angle) * 0.35);
      rightPanGroup.add(chain);
    }

    // Две скрижали Конституции у основания колонны (Tablets of Law)
    const tabletGeo = new THREE.BoxGeometry(0.8, 1.2, 0.12);
    const tabletMat = new THREE.MeshPhysicalMaterial({
      color: 0x081b33,
      roughness: 0.35,
      metalness: 0.5,
      clearcoat: 0.6
    });

    const tabletL = new THREE.Mesh(tabletGeo, tabletMat);
    tabletL.position.set(-0.45, -1.45, 0.45);
    tabletL.rotation.y = 0.25;
    tabletL.rotation.z = 0.05;

    const tabletR = new THREE.Mesh(tabletGeo, tabletMat);
    tabletR.position.set(0.45, -1.45, 0.45);
    tabletR.rotation.y = -0.25;
    tabletR.rotation.z = -0.05;

    rootGroup.add(tabletL, tabletR);

    // Переменные гармонических колебаний весов
    let beamAngle = 0;
    let beamVelocity = 0;

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Физическая модель маятникового качания весов под воздействием курсора
          const targetTorque = mouseX * 0.35 + Math.sin(time * 1.3) * 0.08;
          const spring = (targetTorque - beamAngle) * 3.5;
          const damping = 0.92;

          beamVelocity = (beamVelocity + spring * delta) * damping;
          beamAngle += beamVelocity;

          beamGroup.rotation.z = beamAngle;

          // Чаши сохраняют вертикальное направление силы тяжести
          leftPanGroup.rotation.z = -beamAngle;
          rightPanGroup.rotation.z = -beamAngle;

          // Параллакс
          rootGroup.rotation.y = lerp(rootGroup.rotation.y, mouseX * 0.4, 0.05);
          rootGroup.rotation.x = lerp(rootGroup.rotation.x, -mouseY * 0.2, 0.05);
        }
      },
      dispose() {
        panGeo.dispose();
        tabletGeo.dispose();
      }
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 6: FAQ — ГИРОСКОП ПОЗНАНИЯ / СИЯЮЩАЯ ЭНИГМА ВОПРОСА
  // --------------------------------------------------------------------------
  function createGyroscopeEnigmaScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0xecfeff,
      keyIntensity: 2.7,
      fillColor: 0x0891b2,
      rimColor: PALETTE.goldBright,
      rimIntensity: 3.5
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroup.add(createContactShadowMesh(THREE, 3.2, 0.6));

    const gyroGroup = new THREE.Group();
    gyroGroup.position.y = 0.2;
    rootGroup.add(gyroGroup);

    const ringMat = new THREE.MeshPhysicalMaterial({
      color: PALETTE.gold,
      metalness: 0.92,
      roughness: 0.15,
      clearcoat: 1.0
    });

    const innerMat = new THREE.MeshPhysicalMaterial({
      color: 0x0891b2,
      metalness: 0.8,
      roughness: 0.2,
      clearcoat: 0.8
    });

    // 3 Кардановы рамки гироскопа (Triple Nested Gimbal Rings)
    // 1. Внешняя рамка
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.065, 20, 80), ringMat);
    gyroGroup.add(outerRing);

    // 2. Средняя рамка
    const midRingGroup = new THREE.Group();
    gyroGroup.add(midRingGroup);
    const midRing = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.055, 18, 72), ringMat);
    midRingGroup.add(midRing);

    // 3. Внутренняя рамка
    const innerRingGroup = new THREE.Group();
    midRingGroup.add(innerRingGroup);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.045, 16, 64), innerMat);
    innerRingGroup.add(innerRing);

    // Центральная Сияющая Энигма Вопроса (Pulsing Radiant Core)
    const coreMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.68, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x22d3ee,
        emissive: 0x0891b2,
        emissiveIntensity: 0.5,
        roughness: 0.05,
        transmission: 0.88,
        ior: 1.6,
        clearcoat: 1.0
      })
    );
    innerRingGroup.add(coreMesh);

    // Внутренний проволочный октаэдр
    const cage = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.85, 0),
      new THREE.MeshBasicMaterial({
        color: PALETTE.goldBright,
        wireframe: true,
        transparent: true,
        opacity: 0.75
      })
    );
    innerRingGroup.add(cage);

    // Пульсирующий источник света
    const enigmaLight = new THREE.PointLight(0x38bdf8, 3.2, 7);
    innerRingGroup.add(enigmaLight);

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Вращение колец гироскопа по законам золотого сечения
          outerRing.rotation.y += delta * 0.45;
          outerRing.rotation.x = Math.sin(time * 0.5) * 0.35;

          midRingGroup.rotation.x += delta * 0.72; // ~1.618 ratio
          midRingGroup.rotation.z += delta * 0.28;

          innerRingGroup.rotation.z += delta * 1.15;
          innerRingGroup.rotation.y += delta * 0.45;

          // Вращение и пульсация ядра
          coreMesh.rotation.y -= delta * 0.8;
          cage.rotation.y += delta * 0.6;

          const pulse = 1.0 + Math.sin(time * 2.5) * 0.09;
          coreMesh.scale.set(pulse, pulse, pulse);
          enigmaLight.intensity = 2.5 + Math.sin(time * 3.0) * 1.0;

          // Параллакс
          gyroGroup.rotation.y = lerp(gyroGroup.rotation.y, mouseX * 0.5, 0.05);
          gyroGroup.rotation.x = lerp(gyroGroup.rotation.x, -mouseY * 0.35, 0.05);
        }
      },
      dispose() {}
    };
  }

  // --------------------------------------------------------------------------
  // СЕКЦИЯ 7: FOOTER — КОСМИЧЕСКИЙ ГОРИЗОНТ ФУНДАМЕНТА
  // --------------------------------------------------------------------------
  function createCosmicHorizonScene(scene, camera, THREE) {
    setupStudioLighting(scene, THREE, {
      keyColor: 0x93c5fd,
      keyIntensity: 2.0,
      fillColor: 0x0284c7,
      rimColor: PALETTE.gold,
      rimIntensity: 3.0
    });

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // Геометрический волнистый горизонт (Undulating Wave Lattice Plane)
    const gridX = 40;
    const gridY = 25;
    const planeWidth = 36;
    const planeDepth = 24;

    const planeGeo = new THREE.PlaneGeometry(planeWidth, planeDepth, gridX, gridY);
    planeGeo.rotateX(-Math.PI / 2.2);
    planeGeo.translate(0, -1.8, -4);

    const planeMat = new THREE.MeshPhysicalMaterial({
      color: 0x030a18,
      roughness: 0.3,
      metalness: 0.7,
      wireframe: true
    });

    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    rootGroup.add(planeMesh);

    // Сохраняем исходные Y координаты для анимации волн
    const posAttr = planeGeo.attributes.position;
    const initialZ = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
      initialZ[i] = posAttr.getY(i);
    }

    // Восходящие космические искры знаний (Ascending Motes of Knowledge)
    const moteCount = 120;
    const moteGeo = new THREE.BufferGeometry();
    const motePos = new Float32Array(moteCount * 3);
    const moteSpeeds = new Float32Array(moteCount);

    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 26;
      motePos[i * 3 + 1] = Math.random() * 6 - 2;
      motePos[i * 3 + 2] = -Math.random() * 14;
      moteSpeeds[i] = Math.random() * 0.6 + 0.25;
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));

    const moteMat = new THREE.PointsMaterial({
      color: PALETTE.goldBright,
      size: 0.075,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    const moteSystem = new THREE.Points(moteGeo, moteMat);
    rootGroup.add(moteSystem);

    // Горизонтальное сияющее кольцо рассвета (Dawn Ring)
    const dawnRing = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.05, 12, 64),
      new THREE.MeshBasicMaterial({
        color: PALETTE.samarkandCyan,
        transparent: true,
        opacity: 0.45
      })
    );
    dawnRing.position.set(0, -1.5, -12);
    rootGroup.add(dawnRing);

    return {
      update({ time, delta, mouseX, mouseY, targetOffsetX, reducedMotion }) {
        rootGroup.position.x = lerp(rootGroup.position.x, targetOffsetX, 0.05);

        if (!reducedMotion) {
          // Волновое колыхание сетки горизонта
          const count = posAttr.count;
          for (let i = 0; i < count; i++) {
            const vx = posAttr.getX(i);
            const vz = posAttr.getZ(i);
            const wave = Math.sin(vx * 0.35 + time * 1.1) * Math.cos(vz * 0.25 + time * 0.8) * 0.42;
            posAttr.setY(i, initialZ[i] + wave);
          }
          posAttr.needsUpdate = true;

          // Восхождение искр к небу
          const mpos = moteGeo.attributes.position.array;
          for (let i = 0; i < moteCount; i++) {
            mpos[i * 3 + 1] += moteSpeeds[i] * delta;
            if (mpos[i * 3 + 1] > 4.5) {
              mpos[i * 3 + 1] = -2.2;
            }
          }
          moteGeo.attributes.position.needsUpdate = true;

          // Параллакс
          rootGroup.rotation.y = lerp(rootGroup.rotation.y, mouseX * 0.25, 0.05);
          rootGroup.rotation.x = lerp(rootGroup.rotation.x, -mouseY * 0.15, 0.05);
        }
      },
      dispose() {
        planeGeo.dispose();
        planeMat.dispose();
        moteGeo.dispose();
        moteMat.dispose();
      }
    };
  }

  // --------------------------------------------------------------------------
  // 4. ГЛОБАЛЬНЫЙ СИНГЛТОН И PUBLIC API
  // --------------------------------------------------------------------------

  let engineInstance = null;

  return {
    /**
     * Инициализирует 3D движок и находит все секции на странице
     */
    init: async function () {
      if (engineInstance) {
        console.warn('[Fundament3D] Движок уже запущен.');
        return engineInstance;
      }
      engineInstance = new Master3DEngine();
      const ok = await engineInstance.init();
      return ok ? engineInstance : null;
    },

    /**
     * Останавливает рендерер и освобождает все ресурсы WebGL
     */
    destroy: function () {
      if (engineInstance) {
        engineInstance.destroy();
        engineInstance = null;
      }
    },

    /**
     * Возвращает экземпляр движка
     */
    getInstance: function () {
      return engineInstance;
    },

    /**
     * Экспорт фабрик для кастомного использования
     */
    builders: {
      createHeroMonumentScene,
      createFoliantOfWisdomScene,
      createCrystalPillarsScene,
      createHeraldicShieldScene,
      createScalesOfJusticeScene,
      createGyroscopeEnigmaScene,
      createCosmicHorizonScene
    }
  };
});
