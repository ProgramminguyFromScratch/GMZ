class LevelRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        this.tilesetCache = new Map();
        this.wallCache = new Map();
        this.backgroundVariants = new Map();
        
        this.tiles = [];
        this.wallTiles = [];
        this.background = null;
        this.assetsLoaded = false;
        this.tileSize = 60;

        this.needsHue = [..."01111110010010001101100000000001100000000111000001100000001000000001000001001111111001"]
            .flatMap((c, i) => c === "1" ? [i] : []);
    }

    static getDataFromCode(code) {
        try {
            const tokens = code.substring(7).replaceAll("C", "-").replaceAll("B", "+").split("Z");
            const size_x = parseInt(tokens[0], 10);

            let cursor = 1;
            const readSegment = () => {
                const end = tokens.indexOf("", cursor);
                if (end === -1) {
                    const seg = tokens.slice(cursor);
                    cursor = tokens.length;
                    return seg;
                }
                const seg = tokens.slice(cursor, end);
                cursor = end + 1;
                return seg;
            };

            const MAP_data = readSegment();
            const MAP_R_data = readSegment();
            const MAP_DATA = readSegment();
            const WALL_DATA = readSegment();
            const remaining = tokens.slice(cursor);

            const MAP = [];
            for (let i = 0; i < MAP_data.length; i += 2) {
                const value = parseInt(parseFloat(MAP_data[i]));
                const count = parseInt(parseFloat(MAP_data[i + 1]));
                for (let j = 0; j < count; j++) MAP.push(value);
            }

            const MAP_R = [];
            for (let i = 0; i < MAP_R_data.length; i += 2) {
                let value = MAP_R_data[i];
                const count = parseInt(parseFloat(MAP_R_data[i + 1]));
                value = (value === 'Infinity' || (typeof value === 'string' && value.includes('e'))) ? 1 : parseFloat(value);
                for (let j = 0; j < count; j++) MAP_R.push(value);
            }

            const hue = remaining[remaining.length - 2];
            const hue2 = remaining[remaining.length - 1];

            return {
                map: MAP,
                rotations: MAP_R,
                size_x,
                MAP_DATA,
                hue,
                hue2,
                wall: WALL_DATA
            };
        } catch (e) {
            console.error("[getDataFromCode] Error:", e);
            return null;
        }
    }

    async loadAssets(onProgress) {
        // Global, in-memory cache of the raw (un-hued) tile/wall/background
        // images. This lives on `window` for the lifetime of the page, so
        // reopening the level preview multiple times during one visit reuses
        // the already-decoded images instead of re-requesting ~196 files.
        // A page refresh naturally clears it since `window` is recreated.
        window.GMZ_ASSET_CACHE = window.GMZ_ASSET_CACHE || null;

        if (window.GMZ_ASSET_CACHE) {
            // Assets already loaded earlier in this session - reuse instantly.
            const cache = window.GMZ_ASSET_CACHE;
            this.tiles = cache.tiles;
            this.wallTiles = cache.wallTiles;
            this.background = cache.background;
            this.assetsLoaded = true;
            if (onProgress) {
                const total = cache.tiles.length + cache.wallTiles.length + 1;
                for (let i = 0; i < total; i++) onProgress();
            }
            return;
        }

        if (window.GMZ_ASSET_CACHE_LOADING) {
            // Another popup instance is already loading assets - wait for it
            // instead of kicking off a duplicate set of network requests.
            await window.GMZ_ASSET_CACHE_LOADING;
            const cache = window.GMZ_ASSET_CACHE;
            this.tiles = cache.tiles;
            this.wallTiles = cache.wallTiles;
            this.background = cache.background;
            this.assetsLoaded = true;
            return;
        }

        const loadImage = (src) => {
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    if (onProgress) onProgress();
                    resolve(img);
                };
                img.onerror = () => {
                    console.warn(`Failed to load: ${src}`);
                    if (onProgress) onProgress();
                    resolve(null);
                };
                img.src = src;
            });
        };

        window.GMZ_ASSET_CACHE_LOADING = (async () => {
            const tilePromises = [];
            for (let i = 1; i <= 172; i++) {
                tilePromises.push(loadImage(`assets/tiles/${i}.svg`));
            }
            const tiles = await Promise.all(tilePromises);

            const wallPromises = [];
            for (let i = 1; i <= 24; i++) {
                wallPromises.push(loadImage(`assets/wall/${i}.svg`));
            }
            const wallTiles = await Promise.all(wallPromises);

            const background = await new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    if (onProgress) onProgress();
                    resolve(img);
                };
                img.onerror = () => {
                    const fallback = document.createElement('canvas');
                    fallback.width = 480; fallback.height = 360;
                    const fctx = fallback.getContext('2d');
                    fctx.fillStyle = '#4A90E2';
                    fctx.fillRect(0, 0, 480, 360);
                    if (onProgress) onProgress();
                    resolve(fallback);
                };
                img.src = 'assets/bg.svg';
            });

            window.GMZ_ASSET_CACHE = { tiles, wallTiles, background };
            return window.GMZ_ASSET_CACHE;
        })();

        const cache = await window.GMZ_ASSET_CACHE_LOADING;
        window.GMZ_ASSET_CACHE_LOADING = null;

        this.tiles = cache.tiles;
        this.wallTiles = cache.wallTiles;
        this.background = cache.background;
        this.assetsLoaded = true;
    }

    parseCommands(txt) {
        let cmds = [];
        let dy = "";
        const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "." , "-"]
        for (let dx = 0; dx < txt.length; dx++) {
            const c = txt[dx];
            if (DIGITS.includes(c)) {
                dy += c;
            } else {
                if (dy != "") {
                    cmds.push(parseFloat(dy));
                    dy = "";
                }
                cmds.push(c.toLowerCase());
            }
        }
        if (dy != "") {
            cmds.push(parseFloat(dy));
        }
        return cmds;
    }

    getGroup(txt) {
        let num = "";
        const DIGITS = ["0","1","2","3","4","5","6","7","8","9",".","-"];

        for (let i = 0; i < txt.length; i++) {
            const c = txt[i];

            if (c === "g" || c === "G") {
                i++; // move to character after g/G

                while (i < txt.length && DIGITS.includes(txt[i])) {
                    num += txt[i];
                    i++;
                }

                return parseFloat(num);
            }
        }

        return null; // no g/G found
    }

    getHuedTileset(hue) {
        if (hue === 0) return this.tiles;
        if (this.tilesetCache.has(hue)) return this.tilesetCache.get(hue);

        const huedSet = this.tiles.map((tile, i) => {
            if (!tile) return null;
            return this.needsHue.includes(i % 86) 
                ? this.applyColorEffect(tile, hue) 
                : tile;
        });

        this.tilesetCache.set(hue, huedSet);
        return huedSet;
    }

    getHuedWalls(hue) {
        if (hue === 0) return this.wallTiles;
        if (this.wallCache.has(hue)) return this.wallCache.get(hue);

        const huedWalls = this.wallTiles.map(tile => 
            tile ? this.applyColorEffect(tile, hue) : null
        );

        this.wallCache.set(hue, huedWalls);
        return huedWalls;
    }

	rgbToHsv(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
		}
		h = ((h * 60) + 360) % 360;
		const s = max === 0 ? 0 : d / max;
		return [h, s, max];
	}

	hsvToRgb(h, s, v) {
		h /= 60;
		const c = v * s;
		const x = c * (1 - Math.abs(h % 2 - 1));
		const m = v - c;
		const [r, g, b] =
		h < 1 ? [c, x, 0] :
			h < 2 ? [x, c, 0] :
			h < 3 ? [0, c, x] :
			h < 4 ? [0, x, c] :
			h < 5 ? [x, 0, c] : [c, 0, x];
		return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
	}

    applyColorEffect(source, hueShift) {
        const canvas = document.createElement('canvas');
        canvas.width = source.width || 60;
        canvas.height = source.height || 60;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue; // Skip fully transparent pixels

            if (hueShift >= 1000) {
                const gray = data[i];
                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            } else {
                const [h, s, v] = this.rgbToHsv(data[i], data[i+1], data[i+2]);
                let hNorm = (h / 360 + (hueShift % 200) / 200) % 1.0;
                const [r, g, b] = this.hsvToRgb(hNorm * 360, s, v);
                data[i] = r; data[i+1] = g; data[i+2] = b;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    fixHue(hueShift) {
        let realhue;
        const hueShiftStr = String(hueShift);
        if (hueShift === 'Infinity' || hueShiftStr.includes("e") || hueShiftStr.includes("E")) realhue = 1000;
        else if (hueShiftStr === "" || hueShiftStr === " ") realhue = 0;
        else if (hueShiftStr.includes("c") || hueShiftStr.includes("C")) realhue = parseInt(hueShiftStr.replace(/c/gi, "-"));
        else realhue = parseInt(hueShiftStr) % 200;
        return realhue;
    }

    betterModBcJsIsWeird(n, m) {
        return ((n % m) + m) % m;
    }

    render(levelData, camera, zoom = 1) {
        if (!this.assetsLoaded) return;

        const { width, height } = this.canvas;
        const ctx = this.ctx;

        const hue = this.fixHue(levelData.hue);
        const hue2 = this.fixHue(levelData.hue2);

        const activeTileset = this.getHuedTileset(hue);
        const activeWalls = this.getHuedWalls(hue2);

        ctx.clearRect(0, 0, width, height);

        const minCamX = this.canvas.width/zoom/2-30;
        if (camera.x < minCamX) camera.x = minCamX;
        const minCamY = this.canvas.height/zoom/2 - 30;
        if (camera.y < minCamY) camera.y = minCamY;

        const bgKey = `bg_${hue2}`;
        if (!this.backgroundVariants.has(bgKey)) {
            this.backgroundVariants.set(bgKey, this.applyColorEffect(this.background, hue2));
        }
        const bg = this.backgroundVariants.get(bgKey);

        const bgW = 560 * zoom;
        const bgH = 440 * zoom;
        const bgOffsetX = this.betterModBcJsIsWeird(-camera.x * 0.5 * zoom, bgW) - bgW;
        const bgOffsetY = this.betterModBcJsIsWeird(camera.y * 0.5 * zoom, bgH) - bgH;

        for (let tx = bgOffsetX; tx < width; tx += bgW) {
            for (let ty = bgOffsetY; ty < height; ty += bgH) {
                ctx.drawImage(bg, tx, ty, bgW + 2, bgH + 2);
            }
        }

        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-camera.x, camera.y); 

        for (let x = 0; x < levelData.wall.length / 2; x++) {
            const wallIdx = this.betterModBcJsIsWeird(parseInt(levelData.wall[x * 2 + 1]) + 20, 24);
            const tile = activeWalls[wallIdx];
            if (!tile) continue;

            const wallX = (x - 1) * 60 + camera.x * 0.25 - 30;
            let wallY = -(levelData.wall[x * 2]) * 30 - 151 - camera.y * 0.25 - 20;

            const tileHeight = tile.height/2;

            for (let y = wallY; y < camera.y + this.canvas.height; y += tileHeight) {
                ctx.drawImage(tile, wallX, y);
            }
        }

        const viewHalfW = (width / 2) / zoom;
        const viewHalfH = (height / 2) / zoom;
        const startCol = Math.floor((camera.x - viewHalfW) / 60);
        const endCol = Math.ceil((camera.x + viewHalfW) / 60);
        const startRow = Math.floor((camera.y - viewHalfH) / 60);
        const endRow = Math.ceil((camera.y + viewHalfH) / 60);

        for (let isForeground = 0; isForeground <= 1; isForeground++) {
            const offset = isForeground * 86;
            for (let row = startRow; row <= endRow; row++) {
                const rowBase = row * levelData.size_x;
                for (let col = startCol; col <= endCol; col++) {
                    const idx = rowBase + col;
                    if (idx < 0 || idx >= levelData.map.length) continue;

                    const rawTileVal = levelData.map[idx];
                    if (rawTileVal === 0) continue;

                    const tileIndex = rawTileVal - 1 + offset;
                    const tile = activeTileset[tileIndex];
                    if (!tile) continue;

                    const rotation = levelData.rotations[idx] % 4;
                    const tileX = col * 60;
                    const tileY = -row * 60;

                    ctx.save();
                    ctx.translate(tileX, tileY);
                    if (rotation !== 1) {
                        ctx.rotate((rotation - 1) * Math.PI / 2);
                    }
                    ctx.drawImage(tile,-tile.width / 2, -tile.height / 2);
                    ctx.restore();
                }
            }
        }

        let groupData = []
        for (let i = 0; i < levelData.MAP_DATA.length; i += 2) {
            const idx = parseInt(levelData.MAP_DATA[i]);
            const group = this.getGroup(levelData.MAP_DATA[i + 1]);
            if (group === null) continue;
            const isTrigger = levelData.map[idx - 1] === 71 || levelData.map[idx - 1] === 84
            groupData.push({idx: idx, group: group, isTrigger: isTrigger})
        }

        const getTilePosition = (idx) => ({
            x: (idx % levelData.size_x) * 60 - 60,
            y: Math.floor(idx / levelData.size_x) * -60
        });

        function drawNumberHexagon(ctx, number, x, y, size, color) {
            const h = Math.sqrt(3) / 2 * size;

            ctx.beginPath();
            ctx.moveTo(x - size, y);
            ctx.lineTo(x - size / 2, y - h);
            ctx.lineTo(x + size / 2, y - h);
            ctx.lineTo(x + size, y);
            ctx.lineTo(x + size / 2, y + h);
            ctx.lineTo(x - size / 2, y + h);
            ctx.closePath();

            ctx.fillStyle = color;
            ctx.fill();

            ctx.strokeStyle = '#000000';
            ctx.stroke();

            ctx.fillStyle = '#000000';
            ctx.font = size + 'px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(number, x, y);
        }

        for (const trigger of groupData) {
            if (!trigger.isTrigger) continue;
            const { x: triggerX, y: triggerY } = getTilePosition(trigger.idx);

            const tilesInGroup = groupData.filter(
                tile => !tile.isTrigger && tile.group === trigger.group
            );

            for (const tile of groupData) {
                if (tile.isTrigger || tile.group != trigger.group) continue;
                const { x: tileX, y: tileY } = getTilePosition(tile.idx);
                if (tilesInGroup.length < 9) {
                    ctx.beginPath();
                    ctx.moveTo(triggerX, triggerY);
                    ctx.lineTo(tileX, tileY);
                    ctx.stroke();
                }
                drawNumberHexagon(ctx, trigger.group, tileX, tileY, 20, `hsla(${trigger.group * 30}, 100%, 50%, 0.7)`);
            }
            drawNumberHexagon(ctx, trigger.group, triggerX, triggerY, 37, `hsl(${trigger.group * 30}, 100%, 50%)`);
        }
        ctx.restore();
    }
}