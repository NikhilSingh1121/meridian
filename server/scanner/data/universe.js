/**
 * Static fallback universe for the Live Scanner.
 *
 * Used only when no live instrument list is available (replay mode, or NSE/broker
 * unreachable). With a broker connected, the universe and lot sizes come from the
 * broker's instrument dump; without one, from NSE's fo_mktlots.csv / ind_nifty500list.csv
 * archives. Lot sizes are deliberately NOT listed here — they change every few months
 * and a stale lot size would mis-size a position.
 *
 * Symbol list and sectors: NSE F&O stocks as known in 2026 (verify against NSE).
 */
const FNO = {
  "Financial Services": ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "IDFCFIRSTB", "FEDERALBNK", "AUBANK", "BANDHANBNK", "RBLBANK", "INDIANB", "BAJFINANCE", "BAJAJFINSV", "SHRIRAMFIN", "CHOLAFIN", "MUTHOOTFIN", "MANAPPURAM", "LICHSGFIN", "PFC", "RECLTD", "IRFC", "M&MFIN", "LTF", "SBICARD", "HDFCLIFE", "SBILIFE", "ICICIPRULI", "ICICIGI", "LICI", "HDFCAMC", "CDSL", "BSE", "MCX", "ANGELONE", "CAMS", "JIOFIN", "PAYTM", "POLICYBZR", "IIFL", "PNBHOUSING", "NUVAMA", "360ONE", "KFINTECH"],
  "Information Technology": ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT", "COFORGE", "MPHASIS", "OFSS", "KPITTECH", "TATAELXSI", "CYIENT", "TATATECH", "SONACOMS"],
  "Oil & Gas": ["RELIANCE", "ONGC", "IOC", "BPCL", "HINDPETRO", "GAIL", "OIL", "PETRONET", "IGL", "MGL"],
  "Automobile": ["MARUTI", "M&M", "TMPV", "BAJAJ-AUTO", "EICHERMOT", "HEROMOTOCO", "TVSMOTOR", "ASHOKLEY", "BOSCHLTD", "MOTHERSON", "BHARATFORG", "EXIDEIND", "TIINDIA", "UNOMINDA"],
  "FMCG": ["HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "MARICO", "GODREJCP", "COLPAL", "TATACONSUM", "VBL", "UNITDSPR", "PATANJALI"],
  "Pharma & Healthcare": ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA", "ZYDUSLIFE", "TORNTPHARM", "ALKEM", "BIOCON", "GLENMARK", "MANKIND", "APOLLOHOSP", "MAXHEALTH", "FORTIS", "LAURUSLABS", "SYNGENE"],
  "Metals & Mining": ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL", "JINDALSTEL", "NMDC", "COALINDIA", "NATIONALUM", "HINDZINC", "APLAPOLLO"],
  "Capital Goods & Infra": ["LT", "BEL", "HAL", "BHEL", "SIEMENS", "ABB", "CGPOWER", "CUMMINSIND", "POLYCAB", "KEI", "DIXON", "BDL", "MAZDOCK", "SUZLON", "INOXWIND", "RVNL", "IRCTC", "CONCOR", "GMRAIRPORT", "HAVELLS", "VOLTAS", "BLUESTARCO", "SOLARINDS", "ASTRAL", "SUPREMEIND"],
  "Power & Utilities": ["NTPC", "POWERGRID", "TATAPOWER", "ADANIPOWER", "ADANIGREEN", "ADANIENSOL", "JSWENERGY", "NHPC", "SJVN", "TORNTPOWER", "IREDA", "NCC"],
  "Cement & Materials": ["ULTRACEMCO", "GRASIM", "SHREECEM", "AMBUJACEM", "DALBHARAT", "ASIANPAINT", "PIDILITIND", "BERGEPAINT", "UPL", "PIIND", "SRF", "DEEPAKNTR", "TATACHEM", "COROMANDEL", "CHAMBLFERT"],
  "Consumer & Retail": ["TITAN", "TRENT", "DMART", "NYKAA", "ETERNAL", "SWIGGY", "JUBLFOOD", "PAGEIND", "KALYANKJIL", "INDHOTEL", "DELHIVERY", "INDIGO", "NAUKRI", "ADANIENT", "ADANIPORTS", "HUDCO", "PRESTIGE", "DLF", "GODREJPROP", "LODHA", "OBEROIRLTY", "PHOENIXLTD"],
  "Telecom & Media": ["BHARTIARTL", "IDEA", "INDUSTOWERS", "TATACOMM", "PVRINOX", "SUNTV", "ZEEL"],
};

/* Index definitions the engine understands (display name / Yahoo symbol). */
const INDICES = {
  NIFTY: { name: "NIFTY 50", yahoo: "^NSEI", fno: true },
  BANKNIFTY: { name: "NIFTY BANK", yahoo: "^NSEBANK", fno: true },
  FINNIFTY: { name: "NIFTY FIN SERVICE", yahoo: "NIFTY_FIN_SERVICE.NS", fno: true },
  MIDCPNIFTY: { name: "NIFTY MID SELECT", yahoo: "NIFTY_MID_SELECT.NS", fno: true },
  INDIAVIX: { name: "INDIA VIX", yahoo: "^INDIAVIX", fno: false },
};

const SECTOR_OF = {};
for (const [sec, list] of Object.entries(FNO)) for (const s of list) SECTOR_OF[s] = sec;
const FNO_LIST = Object.values(FNO).flat();

/* Names outside F&O used to pad the replay universe toward Nifty-500 size (performance
   testing). In live mode Nifty 500 comes from NSE's constituent list instead. */
const EXTRA_500 = ["ABBOTINDIA", "AIAENG", "AJANTPHARM", "ALKYLAMINE", "AMBER", "APARINDS", "APOLLOTYRE", "ASTERDM", "ATUL", "BALKRISIND", "BATAINDIA", "BAYERCROP", "BEML", "BLUEDART", "CARBORUNIV", "CASTROLIND", "CEATLTD", "CENTRALBK", "CESC", "CLEAN", "CRISIL", "CROMPTON", "DATAPATTNS", "EMAMILTD", "ENDURANCE", "ESCORTS", "FINCABLES", "FLUOROCHEM", "GILLETTE", "GLAXO", "GODREJIND", "GRANULES", "GRAPHITE", "GRINDWELL", "GUJGASLTD", "HAPPSTMNDS", "HONAUT", "IDBI", "IEX", "IOB", "IPCALAB", "JBCHEPHARM", "JKCEMENT", "JSL", "JUBLINGREA", "KAJARIACER", "KANSAINER", "KEC", "KPRMILL", "LALPATHLAB", "LINDEINDIA", "MAHABANK", "METROPOLIS", "MFSL", "MRF", "NAM-INDIA", "NATCOPHARM", "NAVINFLUOR", "NLCINDIA", "PFIZER", "POONAWALLA", "RADICO", "RAINBOW", "RAMCOCEM", "RATNAMANI", "RELAXO", "SAFARI", "SCHAEFFLER", "SKFINDIA", "SOBHA", "STARHEALTH", "SUMICHEM", "SUNDARMFIN", "SUNDRMFAST", "SUVENPHAR", "TATAINVEST", "THERMAX", "TIMKEN", "TRIDENT", "TRITURBINE", "UCOBANK", "VGUARD", "VINATIORGA", "WELCORP", "WHIRLPOOL", "ZENSARTECH", "ZFCVINDIA", "AARTIIND", "ACC", "ABCAPITAL", "ABFRL", "ATGL", "BALRAMCHIN", "BHARATFORG", "BSOFT", "CHALET", "CUB", "DEVYANI", "ELGIEQUIP", "EIDPARRY", "FINEORG", "GESHIP", "GPIL", "HFCL", "HINDCOPPER", "HOMEFIRST", "IRB", "IRCON", "JINDALSAW", "JMFINANCIL", "JYOTHYLAB", "KARURVYSYA", "KIMS", "LATENTVIEW", "LEMONTREE", "MAPMYINDIA", "MEDANTA", "MOTILALOFS", "NBCC", "NH", "OLECTRA", "PCBL", "PNCINFRA", "POLYMED", "RAILTEL", "RATEGAIN", "RITES", "ROUTE", "SAPPHIRE", "SCI", "SHYAMMETL", "SIGNATURE", "SPARC", "SWANENERGY", "TANLA", "TEJASNET", "TITAGARH", "TRIVENI", "UJJIVANSFB", "USHAMART", "UTIAMC", "VARROC", "VIPIND", "WESTLIFE", "ZYDUSWELL"];

module.exports = { FNO, FNO_LIST, SECTOR_OF, INDICES, EXTRA_500: [...new Set(EXTRA_500)].filter((s) => !SECTOR_OF[s]) };
