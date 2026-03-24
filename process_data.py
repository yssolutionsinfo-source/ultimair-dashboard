import pandas as pd
import json
import math
import re

def clean_key(k):
    return re.sub(r'\s+', ' ', str(k)).strip()

def process_file():
    df = pd.read_excel('260119 - TDG90.xlsx')
    records = df.to_dict(orient='records')
    
    # Clean keys
    cleaned_records = []
    for r in records:
        cl = {clean_key(k): v for k, v in r.items()}
        cleaned_records.append(cl)

    output = []
    
    for row in cleaned_records:
        art_nr = row.get('Art nr.') or row.get('Art nr')
        if pd.isna(art_nr): continue
        
        omschrijving = row.get('Omschrijving', '')
        kostprijs = row.get('Kostprijs', 0)
        totaal = row.get('Totaal', 0)
        gem_verkopen = row.get('gem. Verkopen', 0)
        st_dev = row.get('St. dev.', 0)
        levertijd_weken = row.get('Levertijd in weken', 0)
        
        calc_bp = row.get('Bestel-punt', 0)
        curr_bp = row.get('Huidig Bestel-punt', 0)
        calc_max = row.get('Max aantal', 0)
        curr_max = row.get('Huidig max aantal', 0)
        lot = row.get('Vaste Lotgrootte', 1)
        
        waarde_calc = row.get('Voorraadwaarde', 0)
        waarde_huidig = row.get('Huidige voorraadwaarde', 0)
        
        # NaN handling
        totaal = 0 if pd.isna(totaal) else float(totaal)
        gem_verkopen = 0 if pd.isna(gem_verkopen) else float(gem_verkopen)
        st_dev = 0 if pd.isna(st_dev) else float(st_dev)
        calc_bp = 0 if pd.isna(calc_bp) else math.ceil(float(calc_bp))
        curr_bp = 0 if pd.isna(curr_bp) else int(float(curr_bp))
        calc_max = 0 if pd.isna(calc_max) else math.ceil(float(calc_max))
        curr_max = 0 if pd.isna(curr_max) else int(float(curr_max))
        lot = 1 if pd.isna(lot) or lot == 0 else int(float(lot))
        waarde_calc = 0 if pd.isna(waarde_calc) else float(waarde_calc)
        waarde_huidig = 0 if pd.isna(waarde_huidig) else float(waarde_huidig)
        kostprijs = 0 if pd.isna(kostprijs) else float(kostprijs)
        
        # Logic
        status = '✅ OK'
        advies_bp = f"{curr_bp} → {calc_bp}"
        advies_max = f"{curr_max} → {calc_max}"
        uitleg = []
        fin_ind = ""
        
        diff_bp = abs(calc_bp - curr_bp)
        diff_max = abs(calc_max - curr_max)
        
        round_max_lot = math.ceil(calc_max / lot) * lot if lot > 0 else calc_max
        if round_max_lot != calc_max:
            advies_max = f"{curr_max} → {round_max_lot} (afgerond op lot {lot})"
            calc_max = round_max_lot
            diff_max = abs(calc_max - curr_max)

        if totaal <= 0.1:
            status = '❌ Actie nodig'
            uitleg.append(f"Structureel geen of vrijwel geen vraag (totaal = {totaal}). Dit is een slow/non-mover.")
            calc_bp = 0
            calc_max = 0
            advies_bp = f"{curr_bp} → 0"
            advies_max = f"{curr_max} → 0"
            diff_bp = abs(0 - curr_bp)
            diff_max = abs(0 - curr_max)
        else:
            if st_dev > gem_verkopen and gem_verkopen > 0:
                uitleg.append(f"Hoge variatie in vraag opgemerkt (StDev {st_dev:.1f} > Gem {gem_verkopen:.1f}).")
            
            if diff_bp > 0:
                status = '⚠️ Check'
                if calc_bp > curr_bp:
                    uitleg.append(f"Huidig bestelpunt is te laag t.o.v. de levertijd en vraag, verhoog naar {calc_bp} om misgrijpen te voorkomen.")
                else:
                    uitleg.append(f"Huidig bestelpunt is waarschijnlijk te hoog ingesteld ({curr_bp}), theoretisch volstaat {calc_bp}.")
            
            if diff_max > 0:
                status = '⚠️ Check'
                if calc_max > curr_max:
                    uitleg.append(f"Huidig max aantal is te krap, stel in op {calc_max} om bestelfrequentie te optimaliseren.")
                else:
                    uitleg.append(f"Huidig max aantal ({curr_max}) zorgt voor onnodige voorraadopbouw. Advies: verlagen naar {calc_max}.")
                    
            if diff_max == 0 and diff_bp == 0:
                uitleg.append("De huidige instellingen zijn in lijn met het verbruik en de levertijd.")

        if calc_max == 0 and curr_max > 0:
            status = '❌ Actie nodig'
        
        if diff_bp > (calc_bp * 0.5) or diff_max > (calc_max * 0.5):
            if status != '❌ Actie nodig':
                status = '⚠️ Check'
                
        # Financial
        diff_value = (curr_max - calc_max) * kostprijs
        if diff_value > 0 and status != '✅ OK':
            fin_ind = f"Risico op overstock: kapitaalbeslag kan met ca. €{diff_value:.2f} omlaag."
            if diff_value > 500:
                status = '❌ Actie nodig'
        elif diff_value < 0 and status != '✅ OK':
             fin_ind = f"Risico op nee-verkoop. Voorraadwaarde stijgt theoretisch met €{abs(diff_value):.2f} bij optimale instelling."
        else:
             fin_ind = "Financieel stabiel o.b.v. huidige parameters."
             
        if totaal <= 0.1 and curr_max > 0:
            fin_ind = f"Dood kapitaal: Huidige voorraadwaarde is €{waarde_huidig:.2f} zonder structurele verkopen."
            
        output.append({
            'art_nr': str(art_nr),
            'omschrijving': str(omschrijving),
            'totaal_vraag': float(totaal),
            'gem_vraag': float(gem_verkopen),
            'st_dev': float(st_dev),
            'status': status,
            'advies_bp': advies_bp,
            'advies_max': advies_max,
            'uitleg': " ".join(uitleg),
            'fin_ind': fin_ind,
            'kostprijs': float(kostprijs),
            'levertijd': float(levertijd_weken),
            'curr_bp': curr_bp,
            'calc_bp': calc_bp,
            'curr_max': curr_max,
            'calc_max': calc_max,
            'lot': lot
        })
        
    js_content = "const inventoryData = " + json.dumps(output, indent=2) + ";"
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"Processed {len(output)} records.")

if __name__ == '__main__':
    process_file()
