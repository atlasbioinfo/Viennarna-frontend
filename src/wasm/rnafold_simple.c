/**
 * Simplified RNAfold implementation for WebAssembly
 * Based on ViennaRNA's Zuker algorithm
 *
 * Compile with:
 * emcc rnafold_simple.c -o rnafold.js -s EXPORTED_FUNCTIONS='["_fold_sequence","_get_mfe","_get_structure","_malloc","_free"]' -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8"]'
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <emscripten.h>

#define INF 10000000
#define MAXLOOP 30
#define MIN_HAIRPIN 3
#define NBPAIRS 7

// Base encoding
#define BASE_N 0
#define BASE_A 1
#define BASE_C 2
#define BASE_G 3
#define BASE_U 4

// Pair types
#define PAIR_NONE 0
#define PAIR_CG 1
#define PAIR_GC 2
#define PAIR_GU 3
#define PAIR_UG 4
#define PAIR_AU 5
#define PAIR_UA 6

// Turner energy parameters at 37C (in 0.01 kcal/mol)
static int stack37[8][8] = {
    {INF, INF, INF, INF, INF, INF, INF, INF},
    {INF, -240, -330, -210, -140, -210, -210, -140},
    {INF, -330, -340, -250, -150, -220, -240, -150},
    {INF, -210, -250, 130, -50, -140, -130, 130},
    {INF, -140, -150, -50, 30, -60, -100, 30},
    {INF, -210, -220, -140, -60, -110, -90, -60},
    {INF, -210, -240, -130, -100, -90, -130, -90},
    {INF, -140, -150, 130, 30, -60, -90, 130}
};

static int hairpin37[31] = {
    INF, INF, INF, 540, 560, 570, 540, 600, 550, 640, 650,
    660, 670, 680, 690, 690, 700, 710, 710, 720, 720,
    730, 730, 740, 740, 750, 750, 750, 760, 760, 770
};

static int bulge37[31] = {
    INF, 380, 280, 320, 360, 400, 440, 460, 470, 480, 490,
    500, 510, 520, 530, 540, 540, 550, 550, 560, 570,
    570, 580, 580, 580, 590, 590, 600, 600, 600, 610
};

static int internal37[31] = {
    INF, INF, 100, 100, 110, 200, 200, 210, 230, 240, 250,
    260, 270, 280, 290, 290, 300, 310, 310, 320, 330,
    330, 340, 340, 350, 350, 350, 360, 360, 370, 370
};

static int TerminalAU = 50;
static int ML_intern = -90;
static int ML_closing = 930;
static int MAX_NINIO = 300;
static int ninio = 60;
static double lxc = 107.856;

// Global result storage
static char* result_structure = NULL;
static double result_mfe = 0.0;

// Encode base
int encode_base(char c) {
    switch (c) {
        case 'A': case 'a': return BASE_A;
        case 'C': case 'c': return BASE_C;
        case 'G': case 'g': return BASE_G;
        case 'U': case 'u': case 'T': case 't': return BASE_U;
        default: return BASE_N;
    }
}

// Get pair type
int get_pair_type(int b1, int b2) {
    if (b1 == BASE_C && b2 == BASE_G) return PAIR_CG;
    if (b1 == BASE_G && b2 == BASE_C) return PAIR_GC;
    if (b1 == BASE_G && b2 == BASE_U) return PAIR_GU;
    if (b1 == BASE_U && b2 == BASE_G) return PAIR_UG;
    if (b1 == BASE_A && b2 == BASE_U) return PAIR_AU;
    if (b1 == BASE_U && b2 == BASE_A) return PAIR_UA;
    return PAIR_NONE;
}

// Check if pair has terminal penalty
int is_AU_or_GU(int ptype) {
    return ptype == PAIR_AU || ptype == PAIR_UA ||
           ptype == PAIR_GU || ptype == PAIR_UG;
}

// Loop energy with logarithmic extrapolation
int loop_energy(int size, int* table) {
    if (size <= MAXLOOP) return table[size];
    return (int)(table[MAXLOOP] + lxc * log((double)size / MAXLOOP));
}

// Hairpin energy
int hairpin_energy(int* seq, int i, int j) {
    int size = j - i - 1;
    if (size < MIN_HAIRPIN) return INF;

    int ptype = get_pair_type(seq[i], seq[j]);
    if (ptype == PAIR_NONE) return INF;

    int energy = loop_energy(size, hairpin37);
    if (is_AU_or_GU(ptype)) energy += TerminalAU;

    return energy;
}

// Interior loop energy (stacking, bulge, internal)
int interior_energy(int* seq, int i, int j, int p, int q) {
    int ptype_ij = get_pair_type(seq[i], seq[j]);
    int ptype_pq = get_pair_type(seq[p], seq[q]);

    if (ptype_ij == PAIR_NONE || ptype_pq == PAIR_NONE) return INF;

    int n1 = p - i - 1;
    int n2 = j - q - 1;

    // Stacking
    if (n1 == 0 && n2 == 0) {
        return stack37[ptype_ij][ptype_pq];
    }

    // Bulge
    if (n1 == 0 || n2 == 0) {
        int size = n1 + n2;
        int energy = loop_energy(size, bulge37);
        if (size == 1) {
            energy += stack37[ptype_ij][ptype_pq];
        } else {
            if (is_AU_or_GU(ptype_ij)) energy += TerminalAU;
            if (is_AU_or_GU(ptype_pq)) energy += TerminalAU;
        }
        return energy;
    }

    // Internal loop
    int size = n1 + n2;
    int energy = loop_energy(size, internal37);
    int asymmetry = abs(n1 - n2);
    energy += (asymmetry * ninio < MAX_NINIO) ? asymmetry * ninio : MAX_NINIO;

    return energy;
}

// Main folding function
EMSCRIPTEN_KEEPALIVE
int fold_sequence(const char* sequence) {
    int n = strlen(sequence);
    if (n == 0) return -1;

    // Allocate arrays
    int* seq = (int*)malloc((n + 1) * sizeof(int));
    int** c = (int**)malloc((n + 1) * sizeof(int*));
    int** fML = (int**)malloc((n + 1) * sizeof(int*));
    int* f5 = (int*)malloc((n + 1) * sizeof(int));

    for (int i = 0; i <= n; i++) {
        c[i] = (int*)malloc((n + 1) * sizeof(int));
        fML[i] = (int*)malloc((n + 1) * sizeof(int));
        for (int j = 0; j <= n; j++) {
            c[i][j] = INF;
            fML[i][j] = INF;
        }
        f5[i] = 0;
    }

    // Encode sequence (1-indexed)
    seq[0] = BASE_N;
    for (int i = 0; i < n; i++) {
        seq[i + 1] = encode_base(sequence[i]);
    }

    // Fill DP matrices
    for (int d = MIN_HAIRPIN + 1; d <= n; d++) {
        for (int i = 1; i <= n - d; i++) {
            int j = i + d;
            int ptype = get_pair_type(seq[i], seq[j]);

            if (ptype != PAIR_NONE) {
                // Hairpin
                int cij = hairpin_energy(seq, i, j);

                // Interior loops
                for (int p = i + 1; p <= i + MAXLOOP && p < j - MIN_HAIRPIN - 1; p++) {
                    int maxq = (j - 1 < p + MAXLOOP - (p - i - 1)) ? j - 1 : p + MAXLOOP - (p - i - 1);
                    for (int q = j - 1; q >= p + MIN_HAIRPIN + 1 && q >= j - MAXLOOP + (p - i - 1); q--) {
                        if (get_pair_type(seq[p], seq[q]) != PAIR_NONE && c[p][q] < INF) {
                            int energy = interior_energy(seq, i, j, p, q) + c[p][q];
                            if (energy < cij) cij = energy;
                        }
                    }
                }

                // Multiloop
                int ml = INF;
                for (int k = i + MIN_HAIRPIN + 2; k < j - MIN_HAIRPIN - 1; k++) {
                    if (fML[i + 1][k] < INF && fML[k + 1][j - 1] < INF) {
                        int e = fML[i + 1][k] + fML[k + 1][j - 1];
                        if (e < ml) ml = e;
                    }
                }
                if (ml < INF) {
                    int penalty = is_AU_or_GU(ptype) ? TerminalAU : 0;
                    ml += ML_closing + ML_intern + penalty;
                    if (ml < cij) cij = ml;
                }

                c[i][j] = cij;
            }

            // fML
            int fMLij = fML[i][j - 1];
            for (int k = i; k <= j - MIN_HAIRPIN - 1; k++) {
                int ptype_kj = get_pair_type(seq[k], seq[j]);
                if (ptype_kj != PAIR_NONE && c[k][j] < INF) {
                    int penalty = is_AU_or_GU(ptype_kj) ? TerminalAU : 0;
                    int contrib = c[k][j] + ML_intern + penalty;
                    if (k == i) {
                        if (contrib < fMLij) fMLij = contrib;
                    } else if (fML[i][k - 1] < INF) {
                        int e = fML[i][k - 1] + contrib;
                        if (e < fMLij) fMLij = e;
                    }
                }
            }
            fML[i][j] = fMLij;
        }
    }

    // Fill f5
    for (int j = 1; j <= n; j++) {
        f5[j] = f5[j - 1];
        for (int k = 1; k <= j - MIN_HAIRPIN - 1; k++) {
            int ptype = get_pair_type(seq[k], seq[j]);
            if (ptype != PAIR_NONE && c[k][j] < INF) {
                int penalty = is_AU_or_GU(ptype) ? TerminalAU : 0;
                int contrib = c[k][j] + penalty;
                int e = (k == 1) ? contrib : f5[k - 1] + contrib;
                if (e < f5[j]) f5[j] = e;
            }
        }
    }

    // Store result
    result_mfe = f5[n] / 100.0;

    // Allocate result structure
    if (result_structure) free(result_structure);
    result_structure = (char*)malloc(n + 1);
    memset(result_structure, '.', n);
    result_structure[n] = '\0';

    // Backtrack (simplified)
    int* stack_i = (int*)malloc(n * sizeof(int));
    int* stack_j = (int*)malloc(n * sizeof(int));
    int* stack_t = (int*)malloc(n * sizeof(int));
    int sp = 0;

    int j_bt = n;
    while (j_bt > 0) {
        if (f5[j_bt] == f5[j_bt - 1]) {
            j_bt--;
        } else {
            for (int k = 1; k <= j_bt - MIN_HAIRPIN - 1; k++) {
                int ptype = get_pair_type(seq[k], seq[j_bt]);
                if (ptype != PAIR_NONE && c[k][j_bt] < INF) {
                    int penalty = is_AU_or_GU(ptype) ? TerminalAU : 0;
                    int contrib = c[k][j_bt] + penalty;
                    int expected = (k == 1) ? contrib : f5[k - 1] + contrib;
                    if (f5[j_bt] == expected) {
                        result_structure[k - 1] = '(';
                        result_structure[j_bt - 1] = ')';
                        stack_i[sp] = k;
                        stack_j[sp] = j_bt;
                        stack_t[sp] = 1;
                        sp++;
                        j_bt = k - 1;
                        break;
                    }
                }
            }
        }
    }

    // Process stack
    while (sp > 0) {
        sp--;
        int i = stack_i[sp];
        int j = stack_j[sp];

        // Check hairpin
        if (c[i][j] == hairpin_energy(seq, i, j)) continue;

        // Check interior
        int found = 0;
        for (int p = i + 1; p <= i + MAXLOOP && p < j - MIN_HAIRPIN - 1 && !found; p++) {
            for (int q = j - 1; q >= p + MIN_HAIRPIN + 1 && q >= j - MAXLOOP + (p - i - 1) && !found; q--) {
                if (get_pair_type(seq[p], seq[q]) != PAIR_NONE && c[p][q] < INF) {
                    int energy = interior_energy(seq, i, j, p, q) + c[p][q];
                    if (c[i][j] == energy) {
                        result_structure[p - 1] = '(';
                        result_structure[q - 1] = ')';
                        stack_i[sp] = p;
                        stack_j[sp] = q;
                        stack_t[sp] = 1;
                        sp++;
                        found = 1;
                    }
                }
            }
        }

        if (found) continue;

        // Check multiloop
        int ptype = get_pair_type(seq[i], seq[j]);
        for (int k = i + MIN_HAIRPIN + 2; k < j - MIN_HAIRPIN - 1; k++) {
            if (fML[i + 1][k] < INF && fML[k + 1][j - 1] < INF) {
                int penalty = is_AU_or_GU(ptype) ? TerminalAU : 0;
                int ml = fML[i + 1][k] + fML[k + 1][j - 1] + ML_closing + ML_intern + penalty;
                if (c[i][j] == ml) {
                    stack_i[sp] = i + 1;
                    stack_j[sp] = k;
                    stack_t[sp] = 2;
                    sp++;
                    stack_i[sp] = k + 1;
                    stack_j[sp] = j - 1;
                    stack_t[sp] = 2;
                    sp++;
                    break;
                }
            }
        }
    }

    // Cleanup
    free(stack_i);
    free(stack_j);
    free(stack_t);
    free(seq);
    for (int i = 0; i <= n; i++) {
        free(c[i]);
        free(fML[i]);
    }
    free(c);
    free(fML);
    free(f5);

    return 0;
}

EMSCRIPTEN_KEEPALIVE
double get_mfe() {
    return result_mfe;
}

EMSCRIPTEN_KEEPALIVE
const char* get_structure() {
    return result_structure ? result_structure : "";
}
