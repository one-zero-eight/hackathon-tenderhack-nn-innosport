import Button from '@/components/ui/Button'

export default function ButtonPreviewPage() {
  return (
    <div>
      <div className="grid grid-cols-5 items-center justify-center gap-2 p-2">
        <h1 className="text-ui-title font-semibold">Primary</h1>
        <Button variant="primary" size="sm">
          Button
        </Button>
        <Button variant="primary" size="md" color="error">
          Button
        </Button>
        <Button variant="primary" size="lg" color="success">
          Button
        </Button>
        <Button variant="primary" size="xl" color="warning">
          Button
        </Button>
        <h1 className="text-ui-title font-semibold">Outline</h1>
        <Button variant="outline" size="sm" color="warning">
          Button
        </Button>
        <Button variant="outline" size="md" color="success">
          Button
        </Button>
        <Button variant="outline" size="lg">
          Button
        </Button>
        <Button variant="outline" size="xl" color="error">
          Button
        </Button>
        <h1 className="text-ui-title font-semibold">Ghost</h1>
        <Button variant="ghost" size="sm">
          Button
        </Button>
        <Button variant="ghost" size="md" color="warning">
          Button
        </Button>
        <Button variant="ghost" size="lg" color="error">
          Button
        </Button>
        <Button variant="ghost" size="xl" color="success">
          Button
        </Button>
        <h1 className="text-ui-title font-semibold">Disabled</h1>
        <Button variant="ghost" size="sm" disabled>
          Button
        </Button>
        <Button variant="ghost" size="md" disabled>
          Button
        </Button>
        <Button variant="ghost" size="lg" disabled>
          Button
        </Button>
        <Button variant="ghost" size="xl" disabled>
          Button
        </Button>
      </div>
    </div>
  )
}
