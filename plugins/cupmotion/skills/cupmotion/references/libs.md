# Библиотеки для кода ролика: что брать и как

Библиотека нужна, только если делает ролик лучше своего кода. Главный фильтр — **seek-безопасность**: кадр = чистая функция от `t`,
без таймеров, `requestAnimationFrame`, накопленного состояния и `Math.random`. Рецепты ниже собраны в одном тестовом ролике и прогнаны
через `scripts/render.mjs` (3.11.2026): кадры при перемотке `3 → 0.8 → 3 → 0.8` совпали побайтно. Проверено именно то, что записано как «проверено».

## Вердикты

| Библиотека | Брать? | Зачем / почему нет |
|---|---|---|
| **GSAP** 3.15.0 | да | Текст и объекты на одном таймлайне: стаггер, каскады, кривые, SVG. Рецепт — ниже |
| **Flubber** 0.4.2 | да | Морф одной формы в другую: чистая функция `interp(p)`. Готовый «носитель стыка» из `continuity.md` |
| **Rough.js** 4.6.6 | да | Рисунок от руки (стиль «рисованный»). Только с `seed` |
| **three** 0.187.0 | да, основа 3D | Уже в `3d.md`. Рецепт загрузки и seek — ниже |
| **postprocessing** (pmndrs) 6.39.6 | да, к three | Свечение, глубина резкости, хроматическая аберрация. Для читаемого пересвета, не «свечение на всём» |
| tsParticles | нет | Частицы живут на таймере и копят состояние — ломает `seek`. Рой «наночастиц» и так не должен быть основой ролика (правило ядра); нужны искры или конфетти — своя функция `p(i,t)` с сидовым шумом |
| WebGL Fluid | нет | Симуляция шаг за шагом от курсора: состояние между кадрами, перемотать нельзя. Дым и жидкость — через шейдер-шум от `t` или Flubber |
| ShaderGradient | нет | React-компонент поверх react-three-fiber. Движущийся градиент — свой шейдер на 20 строк или слои радиальных градиентов от `t` |
| Theatre.js | нет | Редактор таймлайна для человека; дублирует GSAP-таймлайн и свой `seek` |
| Hydra | нет | Живой кодинг с обратной связью кадра (состояние между кадрами) и лицензия AGPL-3.0, которая тянется на проект |
| LYGIA | осторожно | Лицензия Prosperity (некоммерческая) + Patron: для промо и рекламы нужна патрон-лицензия. По умолчанию свой шум и fbm; копировать функции из LYGIA в ролик — только если у пользователя есть патрон-лицензия |
| Blender | не библиотека | Источник моделей: просить экспорт в GLB (`3d.md`). Рендер самого Blender — другой конвейер, не cupmotion |

Лицензии: three, Flubber, Rough.js, tsParticles — MIT; postprocessing — Zlib; GSAP — своя «no charge»-лицензия (не MIT, условия на gsap.com/standard-license:
перед коммерческим роликом перечитать). Плагины GSAP (SplitText, MorphSVG, DrawSVG) лежат в том же пакете `dist/`; файлы на CDN проверены, работу в рендере — нет.

## Загрузка

Версии закреплены (jsDelivr). Рендер тогда требует интернета; офлайн — `npm i gsap flubber roughjs three postprocessing` в папку проекта и относительные пути (`./node_modules/...`).
```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/flubber@0.4.2/build/flubber.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js"></script>
<script type="importmap">{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js",
  "postprocessing":"https://cdn.jsdelivr.net/npm/postprocessing@6.39.6/build/index.js"}}</script>
```
В `<script type="module">` в конце: `window.READY = Promise.resolve();` и `window.seek(0)`.

## GSAP: один таймлайн на паузе (проверено)
```js
gsap.ticker.lagSmoothing(0);
const tl = gsap.timeline({ paused: true });
tl.fromTo('#t', { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .8, ease: 'power3.out' }, .2);
window.seek = (t) => { tl.time(t); /* + всё, что считается руками */ };
```
- Все твины только внутри этого таймлайна; `gsap.to(...)` отдельно, `repeat: -1`, `onComplete` с побочными эффектами — нет: они завязаны на часы, а не на `t`.
- Случайность в стаггере и `gsap.utils.random` — не использовать; брать сидовый mulberry32 (правило ядра).
- Свои значения, которые не лежат в DOM (прогресс морфа, угол камеры), твинить в объекте `{p:0}` и читать его в `seek`.

## Flubber: морф формы (проверено)
```js
const interp = flubber.interpolate(pathA, pathB, { maxSegmentLength: 8 });   // строится один раз
const P = { p: 0 }; tl.to(P, { p: 1, duration: 2.5, ease: 'power2.inOut' }, .3);
window.seek = (t) => { tl.time(t); el.setAttribute('d', interp(P.p)); };
```
- Звезда → круг прошла плавно; пути — закрытые, без самопересечений. Один → много форм: `flubber.separate` / `flubber.combine`; фигура → круг: `toCircle`.
- Морф — носитель стыка: то, что в кадре, превращается в то, что нужно дальше; константой остаётся цвет и положение (`continuity.md`).

## Rough.js: рисунок от руки (проверено)
- Создавать фигуры **один раз** при загрузке и **всегда с `seed`**: без него каждый вызов рисует по-новому через `Math.random` и ролик не совпадёт с превью.
- Не вызывать `rc.rectangle(...)` в `seek`. Прорисовку делать как «набор штриха»: у каждого `<path>` `strokeDasharray = getTotalLength()`, твин `strokeDashoffset` от длины до 0 на таймлайне.
```js
const rc = rough.svg(svg);
const box = rc.rectangle(120, 700, 700, 260, { seed: 11, roughness: 2.2, fillStyle: 'hachure' });
svg.appendChild(box);
```
- Разные `seed` для разных фигур, иначе все «дрожат» одинаково. Шрифт под рисунок — рукописный (подключить в `window.READY`).

## three + postprocessing (проверено на bloom)
```js
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
composer.addPass(new EffectPass(cam, new BloomEffect({ intensity: .8, luminanceThreshold: .6, mipmapBlur: true })));
window.seek = (t) => { tl.time(t); mesh.rotation.y = t * 1.1; composer.render(1 / 60); };   // фиксированный шаг, без THREE.Clock
```
- `preserveDrawingBuffer: true` — чтобы скриншот холста не вышел пустым.
- Свечение: с `intensity: 2.5` и порогом `.15` тестовая фигура превратилась в розовое пятно без формы. Начинать с `intensity .6–1`, порог `.6+`, светить только эмиссивным материалом нужного объекта.
- DepthOfField, ChromaticAberration — по тому же шаблону, в тесте не гонялись. Эффекты со случайностью внутри (Glitch, Noise) перед использованием проверить перемоткой: одно и то же `t` обязано давать один и тот же кадр.
- Время в шейдерах — только из `t`, не из часов.
