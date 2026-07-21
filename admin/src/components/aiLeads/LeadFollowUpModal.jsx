// 📁 src/components/aiLeads/LeadFollowUpModal.jsx
import React, { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Stack from '@mui/material/Stack'

const toDatetimeLocalValue = value => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const LeadFollowUpModal = ({ open, lead, onClose, onSubmit, loading }) => {
  const [value, setValue] = useState(toDatetimeLocalValue(lead?.nextFollowUpAt))

  React.useEffect(() => {
    if (open) setValue(toDatetimeLocalValue(lead?.nextFollowUpAt))
  }, [open, lead?.nextFollowUpAt])

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Programar seguimiento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Fecha y hora"
            type="datetime-local"
            value={value}
            onChange={event => setValue(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          onClick={() => onSubmit?.(value ? new Date(value).toISOString() : null)}
          disabled={loading}
          variant="contained"
        >
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default LeadFollowUpModal
