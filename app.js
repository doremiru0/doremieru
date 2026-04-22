document.addEventListener('DOMContentLoaded', () => {
  // --- PDF.js Worker 設定 ---
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // --- 状態管理 ---
  const state = {
    imageSrc: null,
    notes: [], strokes: [], currentPath: [],
    mode: 'auto',
    clef: 'treble',
    staffTop: 200, spacing: 15, threshold: 39, scale: 1, imageDim: 50,
    isPainting: false, hoverPos: null, previewPos: null
  };

  const TREBLE_COLOR = 'rgba(244, 114, 182, 0.9)'; 
  const BASS_COLOR = 'rgba(56, 189, 248, 0.9)';   

  // --- DOM要素取得 ---
  const canvas = document.getElementById('main-canvas');
  const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const containerRef = document.getElementById('container-ref');
  const placeholder = document.getElementById('placeholder');
  const statusText = document.getElementById('status-text');
  const helperText = document.getElementById('helper-text');
  const fileUpload = document.getElementById('file-upload');
  
  const btnFullReset = document.getElementById('btn-full-reset');
  const btnAnalyze = document.getElementById('btn-analyze');
  const btnFit = document.getElementById('btn-fit');
  const analyzeBtnContainer = document.getElementById('analyze-btn-container');
  const thresholdContainer = document.getElementById('threshold-container');
  const dragOverlay = document.getElementById('drag-overlay');

  // PDF用DOM
  const pdfModal = document.getElementById('pdf-modal');
  const pdfPageContainer = document.getElementById('pdf-page-container');
  const btnClosePdf = document.getElementById('btn-close-pdf');
  const pdfLoadingIndicator = document.getElementById('pdf-loading-indicator');
  const pdfLoadingText = document.getElementById('pdf-loading-text');

  let currentImage = new Image();

  function makeId() { return Math.random().toString(36).slice(2, 11); }
  function setStatus(text) { if (statusText) statusText.textContent = text; }

  // PDFモーダルを閉じる処理
  if (btnClosePdf) {
    btnClosePdf.addEventListener('click', () => {
      pdfModal.classList.add('hidden');
      if (fileUpload) fileUpload.value = ''; // ファイル選択をリセット
    });
  }

  // --- 座標・判定ロジック ---
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function isAllowedY(y) {
    const margin = state.spacing * 5;
    return y >= (state.staffTop - margin) && y <= (state.staffTop + (state.spacing * 4) + margin);
  }

  function getPitchInfo(y, currentClef) {
    const step = Math.round((y - state.staffTop) / (state.spacing / 2));
    const treblePitches = ['ファ', 'ミ', 'レ', 'ド', 'シ', 'ラ', 'ソ'];
    const bassPitches = ['ラ', 'ソ', 'ファ', 'ミ', 'レ', 'ド', 'シ'];
    const pitches = currentClef === 'treble' ? treblePitches : bassPitches;
    const pitchName = pitches[((step % 7) + 7) % 7];
    return { pitchName, color: currentClef === 'treble' ? TREBLE_COLOR : BASS_COLOR, snappedY: state.staffTop + step * (state.spacing / 2) };
  }

  // --- サイズ・描画処理 ---
  function updateCanvasScale() {
    if (!state.imageSrc || !canvas) return;
    canvas.style.width = (canvas.width * state.scale) + 'px';
    canvas.style.height = (canvas.height * state.scale) + 'px';
  }

  function fitToContainer() {
    if (!currentImage.src || !containerRef) return;
    const containerWidth = containerRef.clientWidth || containerRef.getBoundingClientRect().width;
    if (containerWidth === 0) return; 

    if (currentImage.width > containerWidth) {
      state.scale = (containerWidth / currentImage.width) * 0.98;
    } else {
      state.scale = 1;
    }
    
    const sliderScale = document.getElementById('slider-scale');
    const valScale = document.getElementById('val-scale');
    if (sliderScale) sliderScale.value = state.scale;
    if (valScale) valScale.textContent = Math.round(state.scale * 100) + '%';
    
    updateCanvasScale();
  }

  function render() {
    if (!state.imageSrc || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawStroke = (path, type) => {
      if (path.length === 0) return;
      ctx.globalCompositeOperation = type === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = type === 'eraser' ? 'rgba(0,0,0,1)' : 'rgba(255, 255, 0, 0.42)';
      ctx.lineWidth = Math.max(20, state.spacing * 1.5);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
      if (path.length === 1) ctx.lineTo(path[0].x + 0.01, path[0].y + 0.01);
      else path.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    };

    state.strokes.forEach(s => drawStroke(s.path, s.type));
    if (state.isPainting && (state.mode === 'auto' || state.mode === 'erase_marker')) {
      drawStroke(state.currentPath, state.mode === 'auto' ? 'marker' : 'eraser');
    }

    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const y = state.staffTop + i * state.spacing;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    const margin = state.spacing * 5;
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(0, state.staffTop - margin); ctx.lineTo(canvas.width, state.staffTop - margin); ctx.stroke();
    ctx.setLineDash([]);

    if (state.imageDim > 0) {
      ctx.fillStyle = `rgba(30, 41, 59, ${state.imageDim / 100})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(currentImage, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    state.notes.forEach(n => {
      let drawColor = n.color;
      if (state.mode === 'manual_delete' && state.hoverPos && Math.sqrt((n.x - state.hoverPos.x)**2 + (n.y - state.hoverPos.y)**2) < 15) {
        drawColor = 'rgba(249, 115, 22, 1)'; 
      }
      ctx.fillStyle = drawColor; ctx.beginPath(); ctx.arc(n.x, n.y, 8.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'black'; ctx.lineWidth = 2; ctx.stroke();
      if (n.pitch) {
        ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'white';
        ctx.fillText(n.pitch, n.x + 17, n.y);
      }
    });

    if (state.mode === 'manual_add' && state.previewPos) {
      const { pitchName } = getPitchInfo(state.previewPos.y, state.clef);
      ctx.globalAlpha = 0.8; ctx.fillStyle = 'rgba(250, 204, 21, 0.9)'; ctx.beginPath(); ctx.arc(state.previewPos.x, state.previewPos.y, 8.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
      ctx.fillText(pitchName, state.previewPos.x + 17, state.previewPos.y); ctx.globalAlpha = 1.0;
    }
  }

  // --- PDF・画像アップロード・解析統合処理 ---

  // 画像DataURLを受け取り、アプリのフローに載せる共通関数
  function loadImageDataUrl(dataUrl) {
    state.imageSrc = dataUrl;
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      if (canvas) {
        canvas.width = currentImage.width;
        canvas.height = currentImage.height;
      }
      
      if (placeholder) placeholder.classList.add('hidden');
      if (canvasWrapper) canvasWrapper.classList.remove('hidden');

      state.notes = []; 
      state.strokes = [];
      state.currentPath = [];
      setStatus('五線を合わせてから、操作を選んでください');

      requestAnimationFrame(() => {
        fitToContainer();
        render();
      });
    };
    img.src = state.imageSrc;
  }

  // PDFファイルの解析とサムネイル一覧表示
  async function handlePdfFile(file) {
    if (!window.pdfjsLib) {
      alert('PDF処理ライブラリの読み込みに失敗しました。');
      return;
    }

    pdfModal.classList.remove('hidden');
    pdfPageContainer.innerHTML = '';
    pdfLoadingIndicator.classList.remove('hidden');
    pdfLoadingText.textContent = 'PDFを解析中...';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        
        // サムネイル用は低解像度で軽量にレンダリング (scale: 0.5)
        const viewport = page.getViewport({ scale: 0.5 });
        const thumbCanvas = document.createElement('canvas');
        const thumbCtx = thumbCanvas.getContext('2d');
        thumbCanvas.width = viewport.width;
        thumbCanvas.height = viewport.height;
        
        await page.render({ canvasContext: thumbCtx, viewport: viewport }).promise;
        
        // サムネイルのUI要素作成
        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'cursor-pointer ring-2 ring-transparent hover:ring-blue-500 rounded-xl overflow-hidden bg-white shadow-md transition-all transform hover:-translate-y-1 hover:shadow-xl flex flex-col group';
        
        const imgEl = document.createElement('img');
        imgEl.src = thumbCanvas.toDataURL();
        imgEl.className = 'w-full h-auto object-contain bg-white border-b border-slate-100 group-hover:opacity-90 transition-opacity';
        
        const label = document.createElement('div');
        label.className = 'py-3 text-center text-sm font-black text-slate-600 bg-slate-50 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors';
        label.textContent = `${pageNum} ページ`;

        thumbWrapper.appendChild(imgEl);
        thumbWrapper.appendChild(label);
        
        // ページが選択された時の処理
        thumbWrapper.addEventListener('click', async () => {
          pdfLoadingIndicator.classList.remove('hidden');
          pdfLoadingText.textContent = '高画質で読み込み中...';
          
          try {
            // 本番用のキャンバスには高画質でレンダリング (scale: 3.0 で拡大)
            const highResViewport = page.getViewport({ scale: 3.0 });
            const highResCanvas = document.createElement('canvas');
            const highResCtx = highResCanvas.getContext('2d');
            highResCanvas.width = highResViewport.width;
            highResCanvas.height = highResViewport.height;
            
            await page.render({ canvasContext: highResCtx, viewport: highResViewport }).promise;
            
            // jpeg変換してメイン画像として読み込む
            const dataUrl = highResCanvas.toDataURL('image/jpeg', 0.95);
            pdfModal.classList.add('hidden');
            loadImageDataUrl(dataUrl);
            
          } catch (err) {
            console.error(err);
            alert('ページの読み込みに失敗しました。');
          } finally {
            pdfLoadingIndicator.classList.add('hidden');
          }
        });

        pdfPageContainer.appendChild(thumbWrapper);
      }
    } catch (error) {
      console.error(error);
      alert('PDFの展開に失敗しました。');
      pdfModal.classList.add('hidden');
    } finally {
      pdfLoadingIndicator.classList.add('hidden');
    }
  }

  // ファイル入力時のハンドラー
  function processFile(file) {
    if (!file) return;

    // PDFの場合は専用フローへ分岐
    if (file.type === 'application/pdf') {
      handlePdfFile(file);
      return;
    }

    // 既存の画像ファイルの読み込みフロー
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadImageDataUrl(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  if (fileUpload) {
    fileUpload.addEventListener('change', (e) => processFile(e.target.files[0]));
  }

  // ドラッグ＆ドロップ処理
  const dropZone = document.getElementById('drop-zone');
  if (dropZone && dragOverlay) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dragOverlay.classList.remove('hidden');
    });
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (e.target === dragOverlay || e.target === dropZone) {
        dragOverlay.classList.add('hidden');
      }
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragOverlay.classList.add('hidden');
      processFile(e.dataTransfer.files[0]);
    });
  }

  // --- 解析処理 ---
  function analyze() {
    if (!canvas || !currentImage.src || state.strokes.length === 0) return;
    setStatus('音符（黒塗り＆白抜き）を解析中...');

    setTimeout(() => {
      try {
        const sCanvas = document.createElement('canvas');
        sCanvas.width = canvas.width; sCanvas.height = canvas.height;
        const sctx = sCanvas.getContext('2d', { willReadFrequently: true });
        sctx.drawImage(currentImage, 0, 0);

        const mCanvas = document.createElement('canvas');
        mCanvas.width = canvas.width; mCanvas.height = canvas.height;
        const mctx = mCanvas.getContext('2d', { willReadFrequently: true });

        const drawMaskStroke = (path, type) => {
          if (path.length === 0) return;
          mctx.globalCompositeOperation = type === 'eraser' ? 'destination-out' : 'source-over';
          mctx.strokeStyle = 'rgba(0,0,0,1)';
          mctx.lineWidth = Math.max(20, state.spacing * 1.5);
          mctx.lineCap = 'round'; mctx.lineJoin = 'round';
          mctx.beginPath(); mctx.moveTo(path[0].x, path[0].y);
          if (path.length === 1) mctx.lineTo(path[0].x + 0.01, path[0].y + 0.01);
          else path.forEach(p => mctx.lineTo(p.x, p.y));
          mctx.stroke();
        };
        state.strokes.forEach(s => drawMaskStroke(s.path, s.type));

        const data = sctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const mdata = mctx.getImageData(0, 0, canvas.width, canvas.height).data;
        
        const noteW = Math.max(3, Math.floor(state.spacing * 1.3));
        const noteH = Math.max(3, Math.floor(state.spacing * 0.9));
        const boxArea = noteW * noteH;
        const halfW = Math.floor(noteW / 2); const halfH = Math.floor(noteH / 2);
        const coreHalfW = Math.floor(halfW * 0.5); const coreHalfH = Math.floor(halfH * 0.5);

        const detectedCandidates = [];

        for (const stroke of state.strokes) {
          if (stroke.type === 'eraser') continue;
          const path = stroke.path;
          if (path.length === 0) continue;

          const minX = Math.max(0, Math.floor(Math.min(...path.map(p => p.x)) - state.spacing * 2));
          const maxX = Math.min(canvas.width, Math.ceil(Math.max(...path.map(p => p.x)) + state.spacing * 2));
          const minY = Math.max(0, Math.floor(Math.min(...path.map(p => p.y)) - state.spacing * 2));
          const maxY = Math.min(canvas.height, Math.ceil(Math.max(...path.map(p => p.y)) + state.spacing * 2));

          const width = maxX - minX; const height = maxY - minY;
          const isBlack = new Uint8Array(width * height);

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const globalX = minX + x; const globalY = minY + y;
              const i = (globalY * canvas.width + globalX) * 4;
              if (mdata[i + 3] === 0) continue; 
              const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
              if (brightness < state.threshold) isBlack[y * width + x] = 1;
            }
          }

          for (let y = halfH; y < height - halfH; y += 2) { 
            for (let x = halfW; x < width - halfW; x += 2) {
              let totalBlack = 0; let coreBlack = 0;
              for (let dy = -halfH; dy <= halfH; dy++) {
                for (let dx = -halfW; dx <= halfW; dx++) {
                  if (isBlack[(y + dy) * width + (x + dx)] === 1) {
                    totalBlack++;
                    if (Math.abs(dx) <= coreHalfW && Math.abs(dy) <= coreHalfH) coreBlack++;
                  }
                }
              }
              const minTotalBlack = boxArea * 0.2;
              if (totalBlack < minTotalBlack) continue;
              const outerBlack = totalBlack - coreBlack;
              const score = Math.max(totalBlack, (outerBlack * 1.5) - (coreBlack * 2.0));
              if (score >= boxArea * 0.4) detectedCandidates.push({ x: minX + x, y: minY + y, density: score });
            }
          }
        }

        detectedCandidates.sort((a, b) => b.density - a.density);
        const finalNotes = [];
        const minDistance = state.spacing * 1.1; 

        for (const cand of detectedCandidates) {
          if (!finalNotes.some(n => Math.sqrt((n.x - cand.x)**2 + (n.y - cand.y)**2) < minDistance)) {
            const { pitchName, color, snappedY } = getPitchInfo(cand.y, state.clef);
            finalNotes.push({ pitch: pitchName, color, x: cand.x, y: snappedY, id: makeId() });
          }
        }

        state.notes = [...state.notes, ...finalNotes];
        state.strokes = []; state.currentPath = [];
        
        if (finalNotes.length === 0) setStatus('音符が見つかりませんでした。感度や間隔(S)を調整してください。');
        else setStatus(`音符を ${finalNotes.length}個 検出しました`);
        
        render();
      } catch (e) {
        console.error(e);
        setStatus("解析エラーが発生しました。");
      }
    }, 50);
  }

  // --- UI イベントリスナー登録 ---
  
  // モード切替
  const modeButtons = document.querySelectorAll('[data-mode]');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      state.mode = e.target.dataset.mode;
      modeButtons.forEach(b => b.className = 'py-3 text-xs font-bold rounded-xl transition-all bg-slate-100 text-slate-500 hover:bg-slate-200');
      
      if (state.mode === 'auto') e.target.className = 'py-3 text-xs font-bold rounded-xl transition-all bg-yellow-400 text-slate-900 shadow-md';
      if (state.mode === 'erase_marker') e.target.className = 'py-3 text-xs font-bold rounded-xl transition-all bg-orange-400 text-white shadow-md';
      if (state.mode === 'manual_add') e.target.className = 'py-3 text-xs font-bold rounded-xl transition-all bg-blue-500 text-white shadow-md';
      if (state.mode === 'manual_delete') e.target.className = 'py-3 text-xs font-bold rounded-xl transition-all bg-red-500 text-white shadow-md';

      if (canvas) canvas.className = `mx-auto shadow-sm ${state.mode === 'auto' || state.mode === 'erase_marker' ? 'cursor-crosshair' : 'cursor-pointer'}`;
      
      if (helperText) {
        if (state.mode === 'auto') helperText.textContent = '五線の周辺（上下の点線内）をなぞってマーカーを引きます';
        else if (state.mode === 'erase_marker') helperText.textContent = 'ドラッグしてなぞった部分のマーカーを消去できます';
        else if (state.mode === 'manual_add') helperText.textContent = '五線の周辺で0.3秒止まるとプレビューが表示され、クリックで追加します';
        else helperText.textContent = 'クリックで音符を削除します';
      }
      
      if (analyzeBtnContainer) analyzeBtnContainer.style.display = state.mode === 'auto' ? 'block' : 'none';
      if (thresholdContainer) thresholdContainer.style.display = state.mode === 'auto' ? 'block' : 'none';
      render();
    });
  });

  // 音部記号切り替え
  const clefButtons = document.querySelectorAll('[data-clef]');
  clefButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      state.clef = e.target.dataset.clef;
      clefButtons.forEach(b => b.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-700');
      e.target.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-white text-blue-600 shadow-sm';
      render();
    });
  });

  // スライダー汎用バインド関数
  const bindSlider = (id, stateKey, suffix = '') => {
    const slider = document.getElementById(`slider-${id}`);
    const valText = document.getElementById(`val-${id}`);
    if (slider && valText) {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state[stateKey] = val;
        valText.textContent = (stateKey === 'scale' ? Math.round(val * 100) : val) + suffix;
        if (stateKey === 'scale') updateCanvasScale();
        else render();
      });
    }
  };

  bindSlider('staffTop', 'staffTop');
  bindSlider('spacing', 'spacing');
  bindSlider('scale', 'scale', '%');
  bindSlider('imageDim', 'imageDim', '%');
  bindSlider('threshold', 'threshold');

  // ±ボタンのイベントバインド関数
  const bindSliderButtons = (stateKey, min, max, step) => {
    const buttons = document.querySelectorAll(`button[data-target="${stateKey}"]`);
    const slider = document.getElementById(`slider-${stateKey}`);
    const valText = document.getElementById(`val-${stateKey}`);
    const suffix = stateKey === 'scale' || stateKey === 'imageDim' ? '%' : '';

    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dir = e.target.dataset.dir;
        let val = state[stateKey];
        if (dir === 'add') val = Math.min(max, Math.round((val + step) * 1000) / 1000);
        if (dir === 'sub') val = Math.max(min, Math.round((val - step) * 1000) / 1000);
        
        state[stateKey] = val;
        if (slider) slider.value = val;
        if (valText) valText.textContent = (stateKey === 'scale' ? Math.round(val * 100) : val) + suffix;
        
        if (stateKey === 'scale') updateCanvasScale();
        else render();
      });
    });
  };

  // 各スライダーの±ボタンを設定
  bindSliderButtons('staffTop', 0, 3000, 1);
  bindSliderButtons('spacing', 5, 150, 1);
  bindSliderButtons('scale', 0.1, 3.0, 0.05);
  bindSliderButtons('imageDim', 0, 90, 5);
  bindSliderButtons('threshold', 0, 220, 1);

  if (btnFit) btnFit.addEventListener('click', fitToContainer);
  if (btnAnalyze) btnAnalyze.addEventListener('click', analyze);

  if (btnFullReset) {
    btnFullReset.addEventListener('click', () => {
      if (confirm('現在の編集データを全て消去し、完全に初期状態に戻しますか？')) {
        state.imageSrc = null; state.notes = []; state.strokes = []; state.currentPath = [];
        state.scale = 1; state.staffTop = 200; state.spacing = 15; state.threshold = 39; state.imageDim = 50;
        
        document.getElementById('slider-scale').value = 1; document.getElementById('val-scale').textContent = '100%';
        document.getElementById('slider-staffTop').value = 200; document.getElementById('val-staffTop').textContent = '200';
        document.getElementById('slider-spacing').value = 15; document.getElementById('val-spacing').textContent = '15';
        document.getElementById('slider-threshold').value = 39; document.getElementById('val-threshold').textContent = '39';
        document.getElementById('slider-imageDim').value = 50; document.getElementById('val-imageDim').textContent = '50%';
        
        if (fileUpload) fileUpload.value = '';
        if (canvasWrapper) canvasWrapper.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        setStatus('リセットしました。新しい楽譜画像またはPDFを読み込んでください。');
      }
    });
  }

  // --- キャンバス描画イベント ---
  let previewTimer = null;
  function finishPaint() {
    state.isPainting = false;
    if (state.currentPath.length > 0) {
      state.strokes.push({ type: state.mode === 'erase_marker' ? 'eraser' : 'marker', path: [...state.currentPath] });
    }
    state.currentPath = [];
    render();
  }

  if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
      const pos = getMousePos(e);
      if (state.mode === 'manual_delete') {
        const idx = state.notes.findIndex(n => Math.sqrt((n.x - pos.x)**2 + (n.y - pos.y)**2) < 15);
        if (idx !== -1) { state.notes.splice(idx, 1); setStatus('印を削除しました'); render(); }
        return;
      }
      if (state.mode === 'manual_add') {
        if (!isAllowedY(pos.y)) { setStatus('範囲外です'); return; }
        const { pitchName, color, snappedY } = getPitchInfo(pos.y, state.clef);
        state.notes.push({ pitch: pitchName, color, x: pos.x, y: snappedY, id: makeId() });
        state.previewPos = null; setStatus(`${pitchName} を追加しました`); render();
        return;
      }
      if (!isAllowedY(pos.y)) return;
      state.isPainting = true; state.currentPath = [pos]; render();
    });

    canvas.addEventListener('mousemove', (e) => {
      const pos = getMousePos(e);
      state.hoverPos = pos;
      if (state.mode === 'manual_add') {
        state.previewPos = null; if (previewTimer) clearTimeout(previewTimer);
        if (isAllowedY(pos.y)) {
          previewTimer = setTimeout(() => {
            const { snappedY } = getPitchInfo(pos.y, state.clef);
            state.previewPos = { x: pos.x, y: snappedY }; render();
          }, 300);
        }
      }
      if ((state.mode === 'auto' || state.mode === 'erase_marker') && state.isPainting) {
        if (!isAllowedY(pos.y)) { finishPaint(); return; }
        state.currentPath.push(pos);
      }
      render();
    });

    canvas.addEventListener('mouseup', finishPaint);
    canvas.addEventListener('mouseleave', () => {
      state.hoverPos = null; state.previewPos = null;
      if (previewTimer) clearTimeout(previewTimer);
      finishPaint();
    });
  }
});
