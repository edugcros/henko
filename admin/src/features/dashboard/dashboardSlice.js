import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import dashboardService from "./dashboardService";

export const getDashboardStats = createAsyncThunk(
  "dashboard/get-stats",
  async (_, thunkAPI) => {
    try {
      // Obtenemos el token del estado de usuario
      const token = thunkAPI.getState().user.user.token;
      return await dashboardService.getStats(token);
    } catch (error) {
      return thunkAPI.rejectWithValue(error);
    }
  }
);

const initialState = {
  stats: {
    mostVisited: [],
    mostSold: [],
    monthlyRevenue: [],
  },
  isError: false,
  isLoading: false,
  isSuccess: false,
  message: "",
};

export const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(getDashboardStats.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(getDashboardStats.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isError = false;
        state.isSuccess = true;
        state.stats = action.payload;
      })
      .addCase(getDashboardStats.rejected, (state, action) => {
        state.isLoading = false;
        state.isError = true;
        state.isSuccess = false;
        state.message = action.error;
      });
  },
});

export default dashboardSlice.reducer;