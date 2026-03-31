// ─────────────────────────────────────────────────────────
//  UltimAir – Voorraadadvies App  (v3)
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── DOM refs ─────────────────────────────────
    const tableBody    = document.getElementById('tableBody');
    const searchInput  = document.getElementById('searchInput');
    const filterBtns   = document.querySelectorAll('.filter-btn');
    const statTotal    = document.getElementById('stat-total');
    const statWarning  = document.getElementById('stat-warning');
    const detailModal  = document.getElementById('detailModal');
    const settingsModal= document.getElementById('settingsModal');
    const modalTitle   = document.getElementById('modalTitle');
    const modalBody    = document.getElementById('modalBody');
    const sgSlider     = document.getElementById('serviceGraad');
    const sgDisplay    = document.getElementById('sgDisplay');
    const exportBtn    = document.getElementById('exportBtn');
    const fileUpload   = document.getElementById('fileUpload');
    const uploadText   = document.getElementById('uploadText');
    const fileStatus   = document.getElementById('fileStatus');
    const skuUpload    = document.getElementById('skuUpload');
    const skuUploadText= document.getElementById('skuUploadText');
    const skuStatus    = document.getElementById('skuStatus');
    const emptyState   = document.getElementById('emptyState');
    const tableWrap    = document.getElementById('tableWrap');
    const settingsBtn  = document.getElementById('settingsBtn');
    const sidebarLogo  = document.getElementById('sidebarLogo');

    // Settings inputs
    const logoUpload     = document.getElementById('logoUpload');
    const colorPrimary   = document.getElementById('colorPrimary');
    const colorSidebar   = document.getElementById('colorSidebar');
    const colorPrimaryHex= document.getElementById('colorPrimaryHex');
    const colorSidebarHex= document.getElementById('colorSidebarHex');
    const resetStyle     = document.getElementById('resetStyle');
    const paramLTFactor  = document.getElementById('paramLTFactor');
    const paramEOQ       = document.getElementById('paramEOQ');
    const paramMinSafety = document.getElementById('paramMinSafety');
    const paramCalcMethod= document.getElementById('paramCalcMethod');
    const methodeStaticInfo= document.getElementById('methodeStaticInfo');
    const methodeInfoTxt = document.getElementById('methodeInfoTxt');
    const methodeCustomInputs = document.getElementById('methodeCustomInputs');
    
    // Custom inputs
    const customFormuleVV = document.getElementById('customFormuleVV');
    const customFormuleBP = document.getElementById('customFormuleBP');
    const customFormuleEOQ= document.getElementById('customFormuleEOQ');
    const customFormuleMax= document.getElementById('customFormuleMax');

    const resetFormula   = document.getElementById('resetFormula');
    const seizoenToggle  = document.getElementById('seizoenToggle');
    const seizoenDetails = document.getElementById('seizoenDetails');
    const seizoenOffInfo = document.getElementById('seizoenOffInfo');
    const paramPiekFactor= document.getElementById('paramPiekFactor');
    const applySettings  = document.getElementById('applySettings');

    // State
    let rawData       = [];
    let rawSkuData    = {}; // Map van Artikel -> SKU config
    let processedData = [];
    let currentFilter = 'all';
    let currentSearch = '';

    // Config (mutable by settings)
    let cfg = {
        primary:    '#0064B3',
        sidebar:    '#111c43',
        ltFactor:   1.0,
        eoqPeriod:  1.0,
        minSafety:  0,
        calcMethod: 'ultimair',
        formulaVV:  'Z * Math.sqrt(stDev * ltMnd * gemVraag)',
        formulaBP:  '(gemVraag * ltMnd) + VV',
        formulaEOQ: 'Z * stDev * Math.sqrt(ltMnd)',
        formulaMax: 'BP + EOQ',
        seizoen:    false,
        piekFactor: 2.0
    };

    const DEFAULTS = { ...cfg };

    // ── Probit (inverse normal CDF) ──────────────
    function probit(p) {
        if (p <= 0) return -Infinity;
        if (p >= 1) return  Infinity;
        const a = [2.515517, 0.802853, 0.010328];
        const b = [1.432788, 0.189269, 0.001308];
        function rat(t) {
            return t - (a[0]+t*(a[1]+t*a[2])) / (1+t*(b[0]+t*(b[1]+t*b[2])));
        }
        if (p < 0.5) return -rat(Math.sqrt(-2*Math.log(p)));
        return rat(Math.sqrt(-2*Math.log(1-p)));
    }

    function getZ() { return probit(parseFloat(sgSlider.value)/100); }

    // ── Column name cleaner ───────────────────────
    function clean(s) { return String(s??'').replace(/\s+/g,' ').trim(); }
    function num(v, fb=0) { const n=parseFloat(v); return isNaN(n)?fb:n; }

    function parseRow(row) {
        const get = (...keys) => {
            for (const k of keys)
                for (const rk of Object.keys(row))
                    if (clean(rk).toLowerCase()===k.toLowerCase()) return row[rk];
            return undefined;
        };
        const artNr = clean(get('art nr.','art nr','artnr','artikel nr','artikelnr.','artikelnr','nr.','nr','artikel'));
        if (!artNr) return null;

        // Maandverbruiken: probeer jan t/m dec (inclusief mrt variant)
        const maandKeys = [
            ['jan'],['feb'],['mar','mrt'],['apr'],
            ['mei','may'],['jun'],['jul'],['aug'],
            ['sep'],['okt','oct'],['nov'],['dec']
        ];
        const maandVerb = maandKeys.map(alts => num(get(...alts)));

        // Handle text-based lead times like "5WD" -> 1 week
        let ltWekenRaw = get('levertijd in weken','levertijd weken','lt weken','levertijd (wkn)','levertijd','levertermijn');
        let ltWeken = 4; // default
        if (typeof ltWekenRaw === 'string') {
            const rawClean = ltWekenRaw.toUpperCase().trim();
            if (rawClean.endsWith('WD')) {
                // e.g. "5WD" = 5 WerkDagen = 1 week
                const days = num(rawClean.replace('WD',''));
                ltWeken = Math.max(1, Math.ceil(days / 5));
            } else {
                ltWeken = num(ltWekenRaw, 4);
            }
        } else {
            ltWeken = num(ltWekenRaw, 4);
        }

        return {
            artNr,
            omschr:      clean(get('omschrijving','description','naam') ?? ''),
            kostprijs:   num(get('kostprijs','cost','prijs','ink €','ink')),
            totaal:      num(get('totaal','total')),
            gemVerkopen: num(get('gem. verkopen','gem.verkopen','gemiddelde verkopen','gem verkopen','average')),
            stDev:       num(get('st. dev.','st.dev.','std dev','stddev','standaarddeviatie','sigma')),
            ltWeken,
            lot:         Math.max(1, Math.round(num(get('vaste lotgrootte','lotgrootte','lot','moq'), 1))),
            currBP:      Math.round(num(get('huidig bestel-punt','huidig bestelpunt','current reorder','curr bp','bestelpunt', 'safety voorraad'))),
            currMax:     Math.round(num(get('huidig max aantal','huidig max','current max','maximale voorraad', 'voorraad'))),
            maandVerb
        };
    }

    // ── Seasonal effective demand ─────────────────
    function effectiveDemand(raw) {
        if (!cfg.seizoen) return raw.gemVerkopen;
        const verbs = raw.maandVerb.filter(v=>v>0);
        if (verbs.length === 0) return raw.gemVerkopen;
        const avg = verbs.reduce((s,v)=>s+v,0)/verbs.length;
        if (avg === 0) return raw.gemVerkopen;
        const piek = Math.max(...verbs);
        const index = Math.min(piek/avg, cfg.piekFactor);
        return avg * index;
    }

    // ── Main calculation ──────────────────────────
    function calcItem(raw, z) {
        let { artNr, omschr, kostprijs, totaal, gemVerkopen, stDev, ltWeken, lot, currBP, currMax, maandVerb } = raw;

        // Check for SKU Overrides
        let hasSkuOverride = false;
        if (rawSkuData[artNr]) {
            hasSkuOverride = true;
            const sku = rawSkuData[artNr];
            if (sku.currBP !== undefined) currBP = sku.currBP;
            if (sku.currMax !== undefined) currMax = sku.currMax;
            if (sku.lot !== undefined) lot = sku.lot;
            if (sku.ltWeken !== undefined) ltWeken = sku.ltWeken;
            if (sku.kostprijs !== undefined) kostprijs = sku.kostprijs;
        }

        if (totaal <= 0.1) {
            return {
                art_nr:artNr, omschrijving:omschr, kostprijs,
                totaal_vraag:totaal, gem_vraag:gemVerkopen, st_dev:stDev,
                levertijd:ltWeken, lot, curr_bp:currBP, curr_max:currMax,
                new_bp:0, new_max:0,
                advies_bp:`${currBP} → 0`, advies_max:`${currMax} → 0`,
                status:'❌ Actie nodig',
                uitleg:'Structureel geen of vrijwel geen vraag (totaal ≈ 0). Slow/non-mover. Stel bestelpunt en max op 0.',
                fin_ind: currMax>0
                    ? `Dood kapitaal: ${currMax} × €${kostprijs.toFixed(2)} = €${(currMax*kostprijs).toFixed(2)}.`
                    : 'Geen actief kapitaalbeslag.',
                seizoenActief: false,
                piekFactor: 1
            };
        }

        const ltMnd       = (ltWeken * cfg.ltFactor) / 4.33;
        const effDemand   = effectiveDemand(raw);
        const piekIdx     = gemVerkopen>0 ? effDemand/gemVerkopen : 1;
        
        // Formules
        let newBP, newMax;
        
        if (cfg.calcMethod === 'ultimair') {
            // UltimAir TDG90 Methode:
            // VV = Z * √(StDev * lt_mnd * gem_vraag)
            // BP = (gem_vraag * lt_mnd) + VV
            // EOQ = Z * StDev * √(lt_mnd)
            // Max = BP + EOQ
            
            const customVV = z * Math.sqrt(Math.max(0, stDev * ltMnd * effDemand));
            const avgDemandDuringLT = effDemand * ltMnd;
            newBP = Math.max(0, Math.ceil(avgDemandDuringLT + customVV)) + cfg.minSafety;
            
            const customEOQ = z * stDev * Math.sqrt(ltMnd);
            let rawMax = newBP + Math.max(1, Math.ceil(customEOQ * cfg.eoqPeriod));
            newMax = (lot > 1) ? Math.ceil(rawMax/lot)*lot : rawMax;

        } else if (cfg.calcMethod === 'project') {
            // Barcol-Air Projectmatig
            // VV = gemVraag * lt_mnd * 0.5
            // BP = (gemVraag * lt_mnd) + VV
            // EOQ = gemVraag * eoq_period
            // Max = BP + EOQ
            
            const customVV = effDemand * ltMnd * 0.5;
            newBP = Math.max(0, Math.ceil((effDemand * ltMnd) + customVV)) + cfg.minSafety;
            
            const customEOQ = effDemand * cfg.eoqPeriod;
            let rawMax = newBP + Math.max(1, Math.ceil(customEOQ));
            newMax = (lot > 1) ? Math.ceil(rawMax/lot)*lot : rawMax;

        } else if (cfg.calcMethod === 'custom') {
            // Evaluator helper
            const evaluateCustom = (formulaStr, locals) => {
                try {
                    const keys = Object.keys(locals);
                    const values = Object.values(locals);
                    const func = new Function(...keys, `return (${formulaStr});`);
                    const result = func(...values);
                    return isNaN(result) ? 0 : result;
                } catch(e) {
                    return 0;
                }
            };
            
            const scope = {
                Z: z, stDev: stDev, ltMnd: ltMnd, gemVraag: effDemand,
                lot: lot, minSafety: cfg.minSafety, eoqPeriod: cfg.eoqPeriod
            };
            
            // 1. VV
            const VV = Math.max(0, evaluateCustom(cfg.formulaVV, scope));
            scope.VV = VV;
            
            // 2. BP
            const bpRaw = evaluateCustom(cfg.formulaBP, scope);
            newBP = Math.max(0, Math.ceil(bpRaw));
            scope.BP = newBP;
            
            // 3. EOQ
            const EOQ = evaluateCustom(cfg.formulaEOQ, scope);
            scope.EOQ = EOQ;
            
            // 4. Max
            const maxRaw = evaluateCustom(cfg.formulaMax, scope);
            newMax = Math.max(newBP, Math.ceil(maxRaw));
            if (lot > 1) newMax = Math.ceil(newMax/lot)*lot;
            
        } else {
            // Klassieke Methode:
            // SS = Z * StDev * √(lt_mnd)
            // BP = (gem_vraag * lt_mnd) + SS
            // Max = BP + (gem_vraag * eoqPeriod)
            
            const safetyStock = z * stDev * Math.sqrt(ltMnd) + cfg.minSafety;
            const avgDuringLT = effDemand * ltMnd;
            newBP = Math.max(0, Math.ceil(avgDuringLT + safetyStock));
            
            let rawMax = newBP + Math.max(1, Math.ceil(effDemand * cfg.eoqPeriod));
            newMax = (lot > 1) ? Math.ceil(rawMax/lot)*lot : rawMax;
        }

        const diffBP   = Math.abs(newBP - currBP);
        const diffMax  = Math.abs(newMax - currMax);
        const diffVal  = (currMax - newMax) * kostprijs;

        let uitleg = [];
        if (cfg.seizoen && piekIdx > 1.05)
            uitleg.push(`Seizoenseffect gedetecteerd: piekfactor ${piekIdx.toFixed(2)}× toegepast op gem. vraag.`);
        if (cfg.ltFactor !== 1.0)
            uitleg.push(`Levertijdfactor ${cfg.ltFactor.toFixed(1)}× actief.`);
        if (stDev > gemVerkopen && gemVerkopen > 0)
            uitleg.push(`Hoge vraagvariatie (σ ${stDev.toFixed(1)} > gem. ${gemVerkopen.toFixed(1)}).`);
        if (diffBP > 0)
            uitleg.push(newBP>currBP
                ? `Bestelpunt te laag. Verhoog naar ${newBP}.`
                : `Bestelpunt te hoog. Verlaag naar ${newBP}.`);
        if (diffMax > 0)
            uitleg.push(newMax>currMax
                ? `Max te krap. Verhoog naar ${newMax}.`
                : `Max te hoog (overstock). Verlaag naar ${newMax} (lot=${lot}).`);
        if (hasSkuOverride)
            uitleg.push('Actuele parameters ingeladen vanuit de SKU-Kaart.');
        if (uitleg.length===0)
            uitleg.push('Instellingen in lijn met verbruik, levertijd en servicegraad.');

        let status;
        if (diffVal>500 || (newBP===0&&currBP>0)) status='❌ Actie nodig';
        else if (diffBP>0||diffMax>0)              status='⚠️ Check';
        else                                        status='✅ OK';

        const fin_ind = diffVal>0
            ? `Overstock: ca. €${diffVal.toFixed(2)} te veel kapitaalbeslag.`
            : diffVal<0
                ? `Risico misgrijpen. Optimaal vraagt €${Math.abs(diffVal).toFixed(2)} meer.`
                : 'Financieel stabiel o.b.v. huidige parameters.';

        return {
            art_nr:artNr, omschrijving:omschr, kostprijs,
            totaal_vraag:totaal, gem_vraag:gemVerkopen, st_dev:stDev,
            levertijd:ltWeken, lot, curr_bp:currBP, curr_max:currMax,
            new_bp:newBP, new_max:newMax,
            advies_bp:`${currBP} → ${newBP}`,
            advies_max:`${currMax} → ${newMax}`,
            status, uitleg:uitleg.join(' '), fin_ind,
            seizoenActief: cfg.seizoen && piekIdx>1.05,
            piekFactor: piekIdx,
            hasSkuOverride
        };
    }

    function recalculate() {
        const z = getZ();
        processedData = rawData.map(r=>calcItem(r,z)).filter(Boolean);
    }

    // ── Render ────────────────────────────────────
    function getStatusClass(s) {
        if (s.includes('OK'))    return 'status-ok';
        if (s.includes('Check')) return 'status-check';
        return 'status-danger';
    }

    function renderTable() {
        tableBody.innerHTML='';
        const term = currentSearch.toLowerCase();
        const rows = processedData.filter(item=>{
            const mf = currentFilter==='all' || item.status===currentFilter;
            const ms = item.art_nr.toLowerCase().includes(term)||item.omschrijving.toLowerCase().includes(term);
            return mf&&ms;
        });
        rows.forEach(item=>{
            let badges = '';
            if (item.seizoenActief) badges += '<span class="season-badge" title="Seizoens-invloed">📅</span>';
            if (item.hasSkuOverride) badges += '<span class="season-badge" style="background:rgba(255,255,255,0.2); color:#555; border:1px solid #ccc; font-size:10px; margin-left:5px; border-radius:4px; padding:2px 4px;" title="SKU Data geladen">SKU</span>';
            
            const tr=document.createElement('tr');
            tr.innerHTML=`
                <td><span class="status-badge ${getStatusClass(item.status)}">${item.status}</span>${badges}</td>
                <td><strong>${item.art_nr}</strong></td>
                <td>${item.omschrijving}</td>
                <td>${item.advies_bp}</td>
                <td>${item.advies_max}</td>
                <td class="fin-cell" title="${item.fin_ind}">${item.fin_ind||'–'}</td>
                <td><button class="action-btn" data-art="${item.art_nr}">Details</button></td>
            `;
            tableBody.appendChild(tr);
        });
        document.querySelectorAll('.action-btn').forEach(btn=>
            btn.addEventListener('click',e=>openDetailModal(e.target.getAttribute('data-art'))));
    }

    function updateStats() {
        statTotal.textContent   = processedData.length;
        statWarning.textContent = processedData.filter(d=>!d.status.includes('OK')).length;
    }

    function refresh() { recalculate(); updateStats(); renderTable(); }

    // ── Detail modal ──────────────────────────────
    function openDetailModal(artNr) {
        const item=processedData.find(d=>d.art_nr===artNr);
        if(!item) return;
        modalTitle.textContent=`${item.art_nr} – ${item.omschrijving}`;
        modalBody.innerHTML=`
            <div class="data-grid">
                <div class="data-item"><label>Totale Historische Vraag</label><strong>${item.totaal_vraag} st</strong></div>
                <div class="data-item"><label>Gem. Maandvraag (σ)</label><strong>${item.gem_vraag.toFixed(1)} (${item.st_dev.toFixed(1)})</strong></div>
                <div class="data-item"><label>Kostprijs per stuk</label><strong>€${item.kostprijs.toFixed(2)}</strong></div>
                <div class="data-item"><label>Levertijd / Lot</label><strong>${item.levertijd} wkn × ${cfg.ltFactor}× / ${item.lot} st</strong></div>
                ${item.hasSkuOverride ? '<div class="data-item" style="grid-column: 1 / -1; background:#eef5ff; border:1px solid var(--primary);"><label style="color:var(--primary);">Verrijkt met SKU-Configuratie</label><strong>Actuele levertijd, lotgrootte, kostprijs en huidige BP/Max komen uit de geüploade SKU-Kaart.</strong></div>' : ''}
                <div class="data-item"><label>Servicegraad / Z</label><strong>${sgSlider.value}% / Z=${getZ().toFixed(3)}</strong></div>
                <div class="data-item"><label>Methode</label><strong>${cfg.calcMethod === 'ultimair' ? 'TDG90' : (cfg.calcMethod === 'project' ? 'Projectmatig' : (cfg.calcMethod === 'klassiek' ? 'Klassiek' : 'Mijn Formule'))}</strong></div>
                <div class="data-item"><label>Seizoen?</label><strong>${item.seizoenActief?`Ja – factor ${item.piekFactor.toFixed(2)}×`:'Nee'}</strong></div>
            </div>
            <div class="logic-box">
                <h4>Onderbouwing Advies</h4>
                <p>${item.uitleg}</p>
                <br>
                <p><strong>Bestelpunt:</strong> ${item.advies_bp}</p>
                <p><strong>Max Aantal:</strong> ${item.advies_max}</p>
            </div>
            ${item.fin_ind?`<div class="fin-box" style="margin-top:14px"><h4>Financiële Impact</h4><p>${item.fin_ind}</p></div>`:''}
        `;
        detailModal.classList.add('show');
    }

    // ── Generic modal close ───────────────────────
    document.querySelectorAll('[data-close]').forEach(btn=>{
        btn.addEventListener('click',()=>document.getElementById(btn.dataset.close).classList.remove('show'));
    });
    window.addEventListener('click',e=>{
        if(e.target===detailModal)  detailModal.classList.remove('show');
        if(e.target===settingsModal) settingsModal.classList.remove('show');
    });

    // ── Settings modal ────────────────────────────
    settingsBtn.addEventListener('click',()=>settingsModal.classList.add('show'));

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
            document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Live color preview
    colorPrimary.addEventListener('input',()=>colorPrimaryHex.textContent=colorPrimary.value);
    colorSidebar.addEventListener('input',()=>colorSidebarHex.textContent=colorSidebar.value);

    // Seizoen toggle
    seizoenToggle.addEventListener('change',()=>{
        seizoenDetails.style.display = seizoenToggle.checked ? 'block' : 'none';
        seizoenOffInfo.style.display = seizoenToggle.checked ? 'none'  : 'block';
    });

    // Logo upload
    logoUpload.addEventListener('change',e=>{
        const file=e.target.files[0];
        if(!file) return;
        const reader=new FileReader();
        reader.onload=ev=>{ sidebarLogo.src=ev.target.result; };
        reader.readAsDataURL(file);
    });

    // Reset style
    resetStyle.addEventListener('click',()=>{
        colorPrimary.value='#0064B3'; colorPrimaryHex.textContent='#0064B3';
        colorSidebar.value='#111c43'; colorSidebarHex.textContent='#111c43';
        sidebarLogo.src='ultimair_logo.png';
        applyColor('#0064B3','#111c43');
    });

    // Config method info
    paramCalcMethod.addEventListener('change', () => {
        if (paramCalcMethod.value === 'custom') {
            methodeStaticInfo.style.display = 'none';
            methodeCustomInputs.style.display = 'block';
        } else {
            methodeStaticInfo.style.display = 'block';
            methodeCustomInputs.style.display = 'none';
            
            if (paramCalcMethod.value === 'ultimair') {
                methodeInfoTxt.innerHTML = `
                    <strong>UltimAir TDG90 Tweaks:</strong>
                    <code>VV = Z × √(StDev × levertijd_mnd × gem_vraag)</code>
                    <code>Bestelpunt = (gem_vraag × levertijd_mnd) + VV</code>
                    <code>EOQ = Z × StDev × √(levertijd_mnd)</code>
                    <code>Max Aantal = Bestelpunt + EOQ</code>
                `;
            } else if (paramCalcMethod.value === 'project') {
                methodeInfoTxt.innerHTML = `
                    <strong>Barcol-Air Projectmatig:</strong>
                    <code>Veiligheidsvoorraad (VV) = gem_vraag × levertijd_mnd × 0.5</code>
                    <code>Bestelpunt = (gem_vraag × levertijd_mnd) + VV</code>
                    <code>Bestelgrootte (EOQ) = gem_vraag × EOQ_periode</code>
                    <code>Max Aantal = Bestelpunt + EOQ</code>
                `;
            } else {
                methodeInfoTxt.innerHTML = `
                    <strong>Klassieke Formules:</strong>
                    <code>Veiligheidsvoorraad (SS) = Z × σ × √(levertijd)</code>
                    <code>Bestelpunt = (gem_vraag × levertijd) + SS</code>
                    <code>Max Aantal = Bestelpunt + gem_vraag</code>
                `;
            }
        }
    });

    // Reset formula
    resetFormula.addEventListener('click',()=>{
        paramLTFactor.value='1.0';
        paramEOQ.value='1';
        paramMinSafety.value='0';
        paramCalcMethod.value='ultimair';
        paramCalcMethod.dispatchEvent(new Event('change'));
        customFormuleVV.value = 'Z * Math.sqrt(stDev * ltMnd * gemVraag)';
        customFormuleBP.value = '(gemVraag * ltMnd) + VV';
        customFormuleEOQ.value = 'Z * stDev * Math.sqrt(ltMnd)';
        customFormuleMax.value = 'BP + EOQ';
    });

    // Apply settings
    applySettings.addEventListener('click',()=>{
        // Colors
        const pc=colorPrimary.value;
        const sc=colorSidebar.value;
        applyColor(pc,sc);
        cfg.primary=pc; cfg.sidebar=sc;

        // Formula
        cfg.ltFactor   = Math.max(0.5, parseFloat(paramLTFactor.value)||1.0);
        cfg.eoqPeriod  = Math.max(0.5, parseFloat(paramEOQ.value)||1.0);
        cfg.minSafety  = Math.max(0,   parseInt(paramMinSafety.value)||0);
        cfg.calcMethod = paramCalcMethod.value;
        
        cfg.formulaVV  = customFormuleVV.value;
        cfg.formulaBP  = customFormuleBP.value;
        cfg.formulaEOQ = customFormuleEOQ.value;
        cfg.formulaMax = customFormuleMax.value;

        // Seizoen
        cfg.seizoen    = seizoenToggle.checked;
        cfg.piekFactor = Math.max(1.0, parseFloat(paramPiekFactor.value)||2.0);

        settingsModal.classList.remove('show');
        if(rawData.length>0) refresh();
    });

    function applyColor(primary, sidebar) {
        const root=document.documentElement;
        // Darken primary by ~15%
        const darker=darken(primary,15);
        root.style.setProperty('--primary', primary);
        root.style.setProperty('--primary-hover', darker);
        root.style.setProperty('--sidebar-bg', sidebar);
    }

    function darken(hex, pct) {
        let r=parseInt(hex.slice(1,3),16);
        let g=parseInt(hex.slice(3,5),16);
        let b=parseInt(hex.slice(5,7),16);
        const f=1-pct/100;
        r=Math.round(r*f); g=Math.round(g*f); b=Math.round(b*f);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    }

    // ── File Upload ───────────────────────────────
    fileUpload.addEventListener('change',e=>{
        const file=e.target.files[0];
        if(!file) return;
        uploadText.textContent=`📄 ${file.name}`;
        fileStatus.textContent='Laden…';
        const reader=new FileReader();
        reader.onload=ev=>{
            try {
                const wb   = XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
                const ws   = wb.Sheets[wb.SheetNames[0]];

                // Try to find the correct header row. We'll read raw data first.
                const rawArr = XLSX.utils.sheet_to_json(ws, {header: 1});
                let headerRowIdx = 0;
                for (let i=0; i<Math.min(10, rawArr.length); i++) {
                    const row = rawArr[i] || [];
                    const strRow = row.map(c => String(c||'').toLowerCase());
                    if (strRow.includes('nr.') || strRow.includes('artikel') || strRow.includes('artikelnr.') || strRow.includes('omschrijving')) {
                        headerRowIdx = i;
                        break;
                    }
                }

                // Read with correct header row
                const rows = XLSX.utils.sheet_to_json(ws,{defval:0, range: headerRowIdx});
                rawData    = rows.map(parseRow).filter(Boolean);
                fileStatus.textContent=`✅ ${rawData.length} artikelen ingeladen`;
                emptyState.style.display='none';
                tableWrap.style.display='block';
                exportBtn.disabled=false;
                refresh();
            } catch(err) {
                fileStatus.textContent='❌ Fout bij inlezen bestand';
                console.error(err);
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // ── SKU Upload ───────────────────────────────
    skuUpload.addEventListener('change',e=>{
        const file=e.target.files[0];
        if(!file) return;
        skuUploadText.textContent=`📄 ${file.name}`;
        skuStatus.textContent='Laden…';
        const reader=new FileReader();
        reader.onload=ev=>{
            try {
                const wb   = XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
                const ws   = wb.Sheets[wb.SheetNames[0]];

                const rawArr = XLSX.utils.sheet_to_json(ws, {header: 1});
                let headerRowIdx = 0;
                for (let i=0; i<Math.min(10, rawArr.length); i++) {
                    const strRow = (rawArr[i] || []).map(c => String(c||'').toLowerCase());
                    if (strRow.includes('nr.') || strRow.includes('artikel') || strRow.includes('artikelnr.') || strRow.includes('art nr.')) {
                        headerRowIdx = i; break;
                    }
                }

                const rows = XLSX.utils.sheet_to_json(ws,{defval:0, range: headerRowIdx});
                rawSkuData = {};
                let count = 0;
                rows.map(parseRow).filter(Boolean).forEach(r => {
                    // Only keep overrides
                    rawSkuData[r.artNr] = {
                        currBP: r.currBP,
                        currMax: r.currMax,
                        lot: r.lot,
                        ltWeken: r.ltWeken,
                        kostprijs: r.kostprijs
                    };
                    count++;
                });
                
                skuStatus.textContent=`✅ ${count} SKU's ingeladen`;
                if(rawData.length > 0) refresh();
            } catch(err) {
                skuStatus.textContent='❌ Fout bij inlezen configuratie';
                console.error(err);
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // ── Servicegraad slider ───────────────────────
    sgSlider.addEventListener('input',()=>{
        sgDisplay.textContent=`${parseFloat(sgSlider.value).toFixed(1)}%`;
        if(rawData.length>0) refresh();
    });

    // ── Excel Export ──────────────────────────────
    exportBtn.addEventListener('click',()=>{
        const rows=processedData.map(item=>({
            'Art nr.':                item.art_nr,
            'Omschrijving':           item.omschrijving,
            'Status':                 item.status,
            'Kostprijs (€)':          item.kostprijs,
            'Gem. Vraag/mnd':         +item.gem_vraag.toFixed(1),
            'StDev':                  +item.st_dev.toFixed(1),
            'Levertijd (wkn)':        item.levertijd,
            'Lotgrootte':             item.lot,
            'Methode':                cfg.calcMethod === 'ultimair' ? 'TDG90 Custom' : (cfg.calcMethod === 'project' ? 'Projectmatig' : (cfg.calcMethod === 'klassiek' ? 'Klassiek' : 'Mijn Formule')),
            'Data Bron':              item.hasSkuOverride ? 'Dataset + SKU Kaart' : 'Enkel Dataset',
            'Servicegraad %':         parseFloat(sgSlider.value),
            'Z-factor':               +getZ().toFixed(3),
            'LT-factor':              cfg.ltFactor,
            'EOQ-periode (mnd)':      cfg.eoqPeriod,
            'Min Safety Stock':       cfg.minSafety,
            'Seizoen actief':         cfg.seizoen ? 'Ja' : 'Nee',
            'Seizoen piekfactor':     item.seizoenActief ? +item.piekFactor.toFixed(2) : 1,
            'Huidig Bestelpunt':      item.curr_bp,
            'Geadviseerd Bestelpunt': item.new_bp,
            'Huidig Max Aantal':      item.curr_max,
            'Geadviseerd Max Aantal': item.new_max,
            'Financiële Indicatie':   item.fin_ind
        }));
        const ws=XLSX.utils.json_to_sheet(rows);
        ws['!cols']=[
            {wch:13},{wch:38},{wch:16},{wch:12},{wch:15},{wch:10},
            {wch:14},{wch:12},{wch:14},{wch:10},{wch:10},{wch:18},
            {wch:17},{wch:15},{wch:17},{wch:18},{wch:22},{wch:18},{wch:22},{wch:52}
        ];
        const wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,'Voorraadadvies');
        const d=new Date();
        const s=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        XLSX.writeFile(wb,`Voorraadadvies_UltimAir_${s}.xlsx`);
    });

    // ── Filters & Search ──────────────────────────
    searchInput.addEventListener('input',e=>{ currentSearch=e.target.value; renderTable(); });
    filterBtns.forEach(btn=>{
        btn.addEventListener('click',e=>{
            filterBtns.forEach(b=>b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter=e.target.getAttribute('data-filter');
            renderTable();
        });
    });
});
