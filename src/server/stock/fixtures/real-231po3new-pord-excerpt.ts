// Exact excerpt from the 05 Oct 2026 production 231PO3NEW report.
// P/Ord Qty is the outstanding PO column; field after Physical Stk is Ryr.
export const REAL_231PO3NEW_PORD_EXCERPT = [
  ' Page : 1            **********************************   10:32:43   05 Oct 2026 ',
  '                     *  A U T O P A R T  S Y S T E M  *                         ',
  '                     **********************************                         ',
  '                                                                                ',
  "STOCK USAGES AND REORDER INFORMATION WITH OUTSTANDING PO QTY'S (231PO3NEW)      ",
  '      [Branch ALL] [Select Group ALL] [Other Info ALL] [Sub Grp ALL] [GROUP ALL]',
  'Branch    Group  Part Number      C Description.........atest Cost       Stk     Avail  Pick Qty Physical Stk   Ryr Curr Mth1 Mth2 Mth3 Mth4 Mth5 Mth6 Mth7 Mth8 Mth9Mth10Mth11  Min  MaxOther Info   P/Ord QtySub Grp GROUP   ',
  '-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------',
  'OPTIMUS   PMV    AWC5000            5 Litre Frequent All      4.29    2.0000    2.0000    0.0000       2.0000    22    0    3    0    2   13    2    2    0    0    0    0    0    0    0PRIME                05LITRE          ',
  'SS        CONS   140087             436X197MMX250M HYBRI     45.53    9.0000    9.0000    0.0000       9.0000    56    0    7    2    0    2    6    3   11    3    7   10    5    5   30                    15                ',
  'SS        CONS   202008             generic-457x305x305m      0.71  120.0000  120.0000    0.0000     120.0000  4350    0  540  380  370  400  250  300  510  690  430   90  390  300  720                   480                ',
  '',
  ' Page : 2            **********************************   10:32:43   05 Oct 2026 ',
  '                     *  A U T O P A R T  S Y S T E M  *                         ',
  '                     **********************************                         ',
  '                                                                                ',
  "STOCK USAGES AND REORDER INFORMATION WITH OUTSTANDING PO QTY'S (231PO3NEW)      ",
  '      [Branch ALL] [Select Group ALL] [Other Info ALL] [Sub Grp ALL] [GROUP ALL]',
  'Branch    Group  Part Number      C Description.........atest Cost       Stk     Avail  Pick Qty Physical Stk   Ryr Curr Mth1 Mth2 Mth3 Mth4 Mth5 Mth6 Mth7 Mth8 Mth9Mth10Mth11  Min  MaxOther Info   P/Ord QtySub Grp GROUP   ',
  '-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------',
  'SS        CONS   103050             Individuals -  Roll      18.81    0.0000    0.0000    0.0000       0.0000     2    0    1    0    0    0    0    0    0    1    0    0    0    4   20                     6                ',
  'SS        CONS   32OZ-BOTTLE        Steel Seal 32oz Bott      0.52    0.0000    0.0000    0.0000       0.0000     0    0    0    0    0    0    0    0    0    0    0    0    0    0    0SS 32OZ BOT      10000                ',
  'SS        CONS   500MLBK            Black Boston bottle       0.30 3312.0000 3312.0000    0.0000    3312.0000 30276  600 2983 4787 4376 5836 6455 4056 1183    0    0    0    0 4000 6000                 25200                ',
].join('\n');

export const REAL_231PO3NEW_PORD_EXPECTATIONS = [
  { sku: 'AWC5000', avail: 2, physical: '2.0000', pOrdQty: 0, latestCost: '4.29' },
  { sku: '140087', avail: 9, physical: '9.0000', pOrdQty: 15, latestCost: '45.53' },
  { sku: '202008', avail: 120, physical: '120.0000', pOrdQty: 480, latestCost: '0.71' },
  { sku: '103050', avail: 0, physical: '0.0000', pOrdQty: 6, latestCost: '18.81' },
  { sku: '32OZ-BOTTLE', avail: 0, physical: '0.0000', pOrdQty: 10000, latestCost: '0.52' },
  { sku: '500MLBK', avail: 3312, physical: '3312.0000', pOrdQty: 25200, latestCost: '0.30' },
] as const;
